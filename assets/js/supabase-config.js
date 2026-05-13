(function (window) {
  var config = {
    url: 'https://jhlfcghhvilbczbuuxcw.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGZjZ2hodmlsYmN6YnV1eGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MzU1MTcsImV4cCI6MjA5NDIxMTUxN30.lTAvZ0xQSOKoS4a16YOINRzO6fKJV0q1AbZpaSf4xNQ'
  };

  if (window.RHM_SUPABASE_CONFIG_OVERRIDE) {
    config.url = window.RHM_SUPABASE_CONFIG_OVERRIDE.url || config.url;
    config.anonKey = window.RHM_SUPABASE_CONFIG_OVERRIDE.anonKey || config.anonKey;
  }

  var missingUrl = !config.url || config.url.indexOf('your-project-ref') !== -1;
  var missingKey = !config.anonKey || config.anonKey.indexOf('your-supabase-anon-key') !== -1;

  window.RHM_SUPABASE_CONFIG = config;
  window.RHM_SUPABASE_READY = !missingUrl && !missingKey;
  window.RHM = window.RHM || {};

  window.RHM.getSupabaseClient = function () {
    if (!window.RHM_SUPABASE_READY) return null;
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Supabase client library is not loaded.');
    }
    if (!window.RHM.supabaseClient) {
      window.RHM.supabaseClient = window.supabase.createClient(config.url, config.anonKey);
    }
    return window.RHM.supabaseClient;
  };
})(window);
