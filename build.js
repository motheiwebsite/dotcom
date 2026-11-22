import contentful from 'contentful';
const { createClient } = contentful;
import fs from 'fs';
import path from 'path';

// Replace with your environment variables or credentials
const SPACE_ID = process.env.CONTENTFUL_SPACE_ID || 'YOUR_SPACE_ID';
const ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN || 'YOUR_DELIVERY_TOKEN';

const client = createClient({
  space: SPACE_ID,
  accessToken: ACCESS_TOKEN,
});

async function buildSite() {
  try {
    // 1. Fetch posts from Contentful sorted by newest first
    const response = await client.getEntries({
      content_type: 'blogPost',
      order: '-fields.publishDate',
    });

    const posts = response.items.map(item => ({
      title: item.fields.title,
      slug: item.fields.slug,
      date: new Date(item.fields.publishDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      excerpt: item.fields.excerpt,
      image: item.fields.featuredImage?.fields?.file?.url ? `https:${item.fields.featuredImage.fields.file.url}` : 'https://via.placeholder.com/800x450',
      isFeatured: Boolean(item.fields.isFeatured),
    }));

    // 2. Identify Hero post and grid posts
    const heroPost = posts.find(p => p.isFeatured) || posts[0];
    const gridPosts = posts.filter(p => p !== heroPost);

    // 3. Generate Hero HTML
    const heroHtml = heroPost ? `
      <section class="hero-card">
        <div class="hero-image" style="background-image: url('${heroPost.image}');"></div>
        <div class="hero-content">
          <span class="badge">Featured</span>
          <h2 class="hero-title">${heroPost.title}</h2>
          <p class="hero-excerpt">${heroPost.excerpt}</p>
          <div class="post-meta">
            <span>${heroPost.date}</span>
            <a href="/posts/${heroPost.slug}.html" class="read-more">Read Article →</a>
          </div>
        </div>
      </section>
    ` : '';

    // 4. Generate Grid Cards HTML
    const gridHtml = gridPosts.map(post => `
      <article class="post-card">
        <img src="${post.image}" alt="${post.title}" class="card-image" loading="lazy" />
        <div class="card-content">
          <span class="card-date">${post.date}</span>
          <h3 class="card-title">${post.title}</h3>
          <p class="card-excerpt">${post.excerpt}</p>
          <a href="/posts/${post.slug}.html" class="card-link">Read more</a>
        </div>
      </article>
    `).join('');

    // 5. Inject into Template and Save Output
    const template = fs.readFileSync(path.resolve('template.html'), 'utf-8');
    const finalHtml = template
      .replace('', heroHtml)
      .replace('', gridHtml);

    const distDir = path.resolve('public');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
    
    fs.writeFileSync(path.join(distDir, 'index.html'), finalHtml);
    fs.copyFileSync(path.resolve('style.css'), path.join(distDir, 'style.css'));

    console.log('Site successfully built to /public');
  } catch (error) {
    console.error('Error building site:', error);
    process.exit(1);
  }
}

buildSite();