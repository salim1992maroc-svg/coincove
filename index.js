export default {
  async fetch(request, env) {
    return new Response("COIN COVE TEST OK", {
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    });
  }
};
