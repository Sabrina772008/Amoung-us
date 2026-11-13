/*
 * Star Beans – settings you can change
 * ------------------------------------
 * SERVER_URL is the web address of YOUR multiplayer server (the Node.js part
 * you deploy on Render). It must start with https://
 *
 * Example:  SERVER_URL: "https://star-beans-server.onrender.com"
 *
 * Leave it empty ("") only when testing on your own computer with
 * `node server.js` – then the game connects to the same address it came from.
 *
 * Never put passwords or secret keys in this file – everyone can read it.
 * (The Supabase "publishable" key below is fine: it is made to be public.)
 */
window.STAR_BEANS_CONFIG = {
  SERVER_URL: "https://star-beans-server.onrender.com",

  // Supabase (cousins make their own logins). These are PUBLIC values and are
  // meant to be in web pages. Never put the "secret" key here.
  SUPABASE_URL: "https://qivxncxpbrjxspicgbls.supabase.co",
  SUPABASE_KEY: "sb_publishable_poHAKWFmGFrkonSkv3-XCA_cmzfkdri",
};
