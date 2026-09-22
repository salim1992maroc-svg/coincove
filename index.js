export default {
  async fetch(request, env) {
    try {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS test_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        )
      `).run();

      await env.DB.prepare(`
        INSERT INTO test_users (name)
        VALUES (?)
      `).bind("Coin Cove Test").run();

      const result = await env.DB
        .prepare("SELECT * FROM test_users ORDER BY id DESC LIMIT 5")
        .all();

      return new Response(JSON.stringify({
        success: true,
        database: true,
        message: "D1 READ/WRITE OK",
        rows: result.results
      }, null, 2), {
        headers: {
          "content-type": "application/json; charset=UTF-8"
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: String(error.message || error)
      }, null, 2), {
        status: 500,
        headers: {
          "content-type": "application/json; charset=UTF-8"
        }
      });
    }
  }
};
