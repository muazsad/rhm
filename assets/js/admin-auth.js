(function (window) {
  function getClientOrThrow() {
    if (!window.RHM_SUPABASE_READY) {
      throw new Error('Supabase is not configured yet. Add your project URL and anon key in assets/js/supabase-config.js.');
    }
    return window.RHM.getSupabaseClient();
  }

  function redirectToLogin(reason) {
    var next = encodeURIComponent(window.location.pathname.split('/').pop() || 'admin-dashboard.html');
    var suffix = reason ? '&reason=' + encodeURIComponent(reason) : '';
    window.location.href = 'admin-login.html?next=' + next + suffix;
  }

  function showAdminSetupMessage(message) {
    document.body.innerHTML = [
      '<main style="min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f2f2ee;font-family:Arial,sans-serif;padding:2rem;">',
      '<section style="max-width:560px;border:1px solid #2a2a2a;background:#111;padding:2rem;">',
      '<h1 style="font-size:1.5rem;margin:0 0 1rem;">Admin setup required</h1>',
      '<p style="line-height:1.6;color:#aaa;margin:0;">' + message + '</p>',
      '</section>',
      '</main>'
    ].join('');
  }

  async function getAdminProfile(client, userId) {
    var response = await client
      .from('admin_profiles')
      .select('id,email,role')
      .eq('id', userId)
      .maybeSingle();

    if (response.error) throw response.error;
    return response.data;
  }

  async function loginAdmin(email, password) {
    var client = getClientOrThrow();
    var login = await client.auth.signInWithPassword({ email: email, password: password });
    if (login.error) throw login.error;

    var profile = await getAdminProfile(client, login.data.user.id);
    if (!profile || profile.role !== 'admin') {
      await client.auth.signOut();
      throw new Error('This account does not have admin access.');
    }

    return { user: login.data.user, profile: profile };
  }

  async function requireAdmin() {
    if (!window.RHM_SUPABASE_READY) {
      showAdminSetupMessage('Supabase credentials are missing. Configure assets/js/supabase-config.js before using the admin area.');
      return null;
    }

    var client = getClientOrThrow();
    var sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;

    var session = sessionResult.data.session;
    if (!session || !session.user) {
      redirectToLogin('signin');
      return null;
    }

    var profile = await getAdminProfile(client, session.user.id);
    if (!profile || profile.role !== 'admin') {
      await client.auth.signOut();
      redirectToLogin('forbidden');
      return null;
    }

    return { session: session, profile: profile };
  }

  async function logoutAdmin() {
    var client = window.RHM.getSupabaseClient && window.RHM.getSupabaseClient();
    if (client) await client.auth.signOut();
    window.location.href = 'admin-login.html';
  }

  function wireLogoutLinks() {
    document.querySelectorAll('[data-admin-logout]').forEach(function (node) {
      node.addEventListener('click', function (event) {
        event.preventDefault();
        logoutAdmin();
      });
    });
  }

  window.RHMAdminAuth = {
    loginAdmin: loginAdmin,
    requireAdmin: requireAdmin,
    logoutAdmin: logoutAdmin,
    wireLogoutLinks: wireLogoutLinks
  };
})(window);
