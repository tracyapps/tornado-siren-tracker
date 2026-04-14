const { getSirens } = require("../lib/status-data");

module.exports = async function handler(request, response) {
  try {
    const sirens = await getSirens();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.status(200).send(JSON.stringify(sirens.meta.sources));
  } catch (error) {
    console.error(error);
    response.status(500).json({
      error: "Server error",
      detail: error.message
    });
  }
};
