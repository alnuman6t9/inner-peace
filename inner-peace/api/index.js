import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const path = pathname.split('/').filter(Boolean);

  // Health check
  if (path[0] === 'health') {
    return res.status(200).json({ status: 'ok' });
  }

  // Initialize database
  if (path[0] === 'init-db') {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          author VARCHAR(100) NOT NULL,
          content TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS suggestions (
          id SERIAL PRIMARY KEY,
          post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
          author VARCHAR(100) NOT NULL,
          content TEXT NOT NULL,
          is_admin BOOLEAN DEFAULT FALSE,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      return res.status(200).json({ message: 'Database initialized' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Handle posts
  if (path[0] === 'posts') {
    // GET all posts
    if (req.method === 'GET') {
      try {
        const posts = await sql`
          SELECT * FROM posts ORDER BY timestamp DESC
        `;

        const postsWithSuggestions = await Promise.all(
          posts.rows.map(async (post) => {
            const suggestions = await sql`
              SELECT * FROM suggestions 
              WHERE post_id = ${post.id} 
              ORDER BY timestamp ASC
            `;

            return {
              ...post,
              timestamp: post.timestamp.toISOString(),
              suggestions: suggestions.rows.map(s => ({
                ...s,
                isAdmin: s.is_admin,
                timestamp: s.timestamp.toISOString()
              }))
            };
          })
        );

        return res.status(200).json(postsWithSuggestions);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // POST new post
    if (req.method === 'POST') {
      try {
        const { author, content } = req.body;

        if (!author || !content) {
          return res.status(400).json({ error: 'Author and content required' });
        }

        const result = await sql`
          INSERT INTO posts (author, content) 
          VALUES (${author}, ${content}) 
          RETURNING *
        `;

        const post = result.rows[0];
        return res.status(201).json({
          ...post,
          timestamp: post.timestamp.toISOString(),
          suggestions: []
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  }

  // Handle post by ID
  if (path[0] === 'posts' && path[2] === 'suggestions') {
    const postId = parseInt(path[1]);

    // POST new suggestion
    if (req.method === 'POST') {
      try {
        const { author, content, isAdmin } = req.body;

        if (!author || !content) {
          return res.status(400).json({ error: 'Author and content required' });
        }

        const result = await sql`
          INSERT INTO suggestions (post_id, author, content, is_admin) 
          VALUES (${postId}, ${author}, ${content}, ${isAdmin || false}) 
          RETURNING *
        `;

        const suggestion = result.rows[0];
        return res.status(201).json({
          ...suggestion,
          isAdmin: suggestion.is_admin,
          timestamp: suggestion.timestamp.toISOString()
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  }

  // DELETE post
  if (path[0] === 'posts' && req.method === 'DELETE') {
    const postId = parseInt(path[1]);
    const { adminPassword } = req.query;

    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
      const result = await sql`
        DELETE FROM posts WHERE id = ${postId} RETURNING id
      `;

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: 'Not found' });
}