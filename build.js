import contentful from 'contentful';
const { createClient } = contentful;
import fs from 'fs';
import path from 'path';

const SPACE_ID = process.env.CONTENTFUL_SPACE_ID || 'YOUR_SPACE_ID';
const ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN || 'YOUR_DELIVERY_TOKEN';

const client = createClient({
  space: SPACE_ID,
  accessToken: ACCESS_TOKEN,
});

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeAssetUrl(url = '') {
  if (!url) return '';
  return url.startsWith('//') ? `https:${url}` : url;
}

function renderRichText(node) {
  if (!node) return '';

  if (node.nodeType === 'text') {
    let text = escapeHtml(node.value || '');
    const marks = node.marks || [];
    if (marks.some(m => m.type === 'code')) text = `<code>${text}</code>`;
    if (marks.some(m => m.type === 'bold')) text = `<strong>${text}</strong>`;
    if (marks.some(m => m.type === 'italic')) text = `<em>${text}</em>`;
    return text;
  }

  const childrenHtml = (node.content || []).map(renderRichText).join('');

  switch (node.nodeType) {
    case 'document':
      return childrenHtml;
    case 'paragraph':
      return `<p>${childrenHtml}</p>`;
    case 'heading-2':
      return `<h2>${childrenHtml}</h2>`;
    case 'heading-3':
      return `<h3>${childrenHtml}</h3>`;
    case 'blockquote':
      return `<blockquote>${childrenHtml}</blockquote>`;
    case 'unordered-list':
      return `<ul>${childrenHtml}</ul>`;
    case 'ordered-list':
      return `<ol>${childrenHtml}</ol>`;
    case 'list-item':
      return `<li>${childrenHtml}</li>`;
    case 'hyperlink': {
      const href = escapeHtml(node.data?.uri || '#');
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${childrenHtml}</a>`;
    }
    case 'embedded-asset-block': {
      const url = normalizeAssetUrl(node.data?.target?.fields?.file?.url);
      const title = escapeHtml(node.data?.target?.fields?.title || 'Embedded image');
      return url
        ? `<figure class="article-figure"><img src="${escapeHtml(url)}" alt="${title}" loading="lazy" /></figure>`
        : '';
    }
    default:
      return childrenHtml;
  }
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Markdown links [label](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeHtml(normalizeAssetUrl(url.trim()));
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return html;
}

function renderBodyContent(rawBody) {
  if (!rawBody) return '';

  if (typeof rawBody === 'object' && rawBody.nodeType) {
    return renderRichText(rawBody);
  }

  const blocks = String(rawBody)
    .trim()
    .split(/\n\s*\n|\n/)
    .map(b => b.trim())
    .filter(Boolean);

  return blocks
    .map(block => {
      // Standalone Markdown image: ![alt](url)
      const imgMatch = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        const alt = escapeHtml(imgMatch[1] || 'Article image');
        const src = escapeHtml(normalizeAssetUrl(imgMatch[2].trim()));
        return `<figure class="article-figure"><img src="${src}" alt="${alt}" loading="lazy" /></figure>`;
      }

      // Headings
      if (block.startsWith('### ')) {
        return `<h3>${renderInlineMarkdown(block.slice(4))}</h3>`;
      }
      if (block.startsWith('## ')) {
        return `<h2>${renderInlineMarkdown(block.slice(3))}</h2>`;
      }
      if (block.startsWith('# ')) {
        return `<h2>${renderInlineMarkdown(block.slice(2))}</h2>`;
      }

      // Blockquote
      if (block.startsWith('&gt; ') || block.startsWith('> ')) {
        const quoteText = block.replace(/^>\s?/, '');
        return `<blockquote><p>${renderInlineMarkdown(quoteText)}</p></blockquote>`;
      }

      return `<p>${renderInlineMarkdown(block)}</p>`;
    })
    .join('\n');
}

async function buildSite() {
  try {
    const response = await client.getEntries({
      content_type: 'blogPost',
      order: '-fields.publishDate',
      include: 2,
    });

    const posts = response.items.map(item => {
      const rawDate = item.fields.publishDate ? new Date(item.fields.publishDate) : new Date();
      const formattedDate = rawDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      const rawBodyStr = typeof item.fields.body === 'string' ? item.fields.body : '';
      const firstBodyImgMatch = rawBodyStr.match(/!\[[^\]]*\]\(([^)]+)\)/);
      const fallbackBodyImg = firstBodyImgMatch ? normalizeAssetUrl(firstBodyImgMatch[1].trim()) : '';

      const imageUrl = item.fields.featuredImage?.fields?.file?.url
        ? normalizeAssetUrl(item.fields.featuredImage.fields.file.url)
        : fallbackBodyImg || 'https://via.placeholder.com/800x450?text=Mothei';

      return {
        title: item.fields.title || 'Untitled',
        slug: item.fields.slug || 'post',
        date: formattedDate,
        excerpt: item.fields.excerpt || '',
        image: imageUrl,
        isFeatured: Boolean(item.fields.isFeatured),
        bodyHtml: renderBodyContent(item.fields.body),
      };
    });

    const heroPost = posts.find(p => p.isFeatured) || posts[0];
    const gridPosts = posts.filter(p => p !== heroPost);

    const heroHtml = heroPost
      ? `
      <section class="hero-card">
        <div class="hero-image" style="background-image: url('${escapeHtml(heroPost.image)}');"></div>
        <div class="hero-content">
          <span class="badge">Featured</span>
          <h1 class="hero-title">${escapeHtml(heroPost.title)}</h1>
          <p class="hero-excerpt">${escapeHtml(heroPost.excerpt)}</p>
          <div class="post-meta">
            <span>${escapeHtml(heroPost.date)}</span>
            <a href="/posts/${encodeURIComponent(heroPost.slug)}.html" class="read-more">Read Article →</a>
          </div>
        </div>
      </section>
    `
      : '';

    const gridHtml = gridPosts.length
      ? gridPosts
          .map(
            post => `
      <article class="post-card">
        <a href="/posts/${encodeURIComponent(post.slug)}.html" class="card-image-link">
          <img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" class="card-image" loading="lazy" />
        </a>
        <div class="card-content">
          <span class="card-date">${escapeHtml(post.date)}</span>
          <h3 class="card-title">${escapeHtml(post.title)}</h3>
          <p class="card-excerpt">${escapeHtml(post.excerpt)}</p>
          <a href="/posts/${encodeURIComponent(post.slug)}.html" class="card-link">Read more →</a>
        </div>
      </article>
    `
          )
          .join('')
      : '<p class="empty-state">More articles coming soon.</p>';

    const template = fs.readFileSync(path.resolve('template.html'), 'utf-8');
    const finalHtml = template
      .replace('<!-- HERO_SECTION -->', heroHtml)
      .replace('<!-- POST_GRID -->', gridHtml);

    const publicDir = path.resolve('public');
    const postsDir = path.join(publicDir, 'posts');
    fs.mkdirSync(postsDir, { recursive: true });

    fs.writeFileSync(path.join(publicDir, 'index.html'), finalHtml);
    fs.copyFileSync(path.resolve('style.css'), path.join(publicDir, 'style.css'));

    for (const post of posts) {
      const articlePage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(post.title)} — Mothei</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,600;6..72,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="navbar">
    <div class="container nav-container">
      <a href="/" class="brand-logo">Mothei<span class="brand-dot">.</span></a>
      <nav>
        <a href="/">Home</a>
        <a href="/#articles">Articles</a>
      </nav>
    </div>
  </header>

  <main class="container article-page">
    <a href="/" class="back-link">← Back to all articles</a>
    <article class="article-full">
      <header class="article-header">
        <span class="card-date">${escapeHtml(post.date)}</span>
        <h1 class="article-title">${escapeHtml(post.title)}</h1>
        ${post.excerpt ? `<p class="article-lead">${escapeHtml(post.excerpt)}</p>` : ''}
      </header>
      <img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" class="article-cover" />
      <div class="article-body">
        ${post.bodyHtml}
      </div>
    </article>
  </main>

  <footer class="footer">
    <div class="container footer-inner">
      <p>&copy; 2026 Mothei. Built with Contentful &amp; GitHub Pages.</p>
    </div>
  </footer>
</body>
</html>`;

      fs.writeFileSync(path.join(postsDir, `${post.slug}.html`), articlePage);
    }

    console.log(`Site successfully built to /public (${posts.length} post(s))`);
  } catch (error) {
    console.error('Error building site:', error);
    process.exit(1);
  }
}

buildSite();
