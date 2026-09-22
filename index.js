export default {
  async fetch(request, env) {
    return new Response(JSON.stringify({
      success: true,
      app: "Coin Cove",
      database: !!env.DB
    }), {
      headers: {
        "content-type": "application/json; charset=UTF-8"
      }
    });
  }
};
