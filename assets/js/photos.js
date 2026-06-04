(function () {
  const albums = Array.isArray(window.RHM_ALBUMS) ? window.RHM_ALBUMS : [];
  const state = {
    openAlbum: null,
    images: [],
    index: 0,
    touchStartX: 0
  };

  const els = {};

  function accessKey(albumId) {
    return `rhm-photo-access:${albumId}`;
  }

  function getToken(albumId) {
    try {
      return window.localStorage.getItem(accessKey(albumId));
    } catch {
      return null;
    }
  }

  function setToken(albumId, token) {
    try {
      window.localStorage.setItem(accessKey(albumId), token);
    } catch {}
  }

  function clearToken(albumId) {
    try {
      window.localStorage.removeItem(accessKey(albumId));
    } catch {}
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setStatus(message, tone = "neutral") {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.dataset.tone = tone;
  }

  function albumCard(album) {
    const hasToken = Boolean(getToken(album.id));
    const isLocked = album.locked && !hasToken;
    const action = isLocked ? "Unlock Album" : "View Album";
    const badge = album.locked ? `${escapeHtml(album.price)} Access` : "Free Album";

    return `
      <article class="album-card reveal" data-album-id="${escapeHtml(album.id)}">
        <div class="album-cover-wrap">
          <img class="album-cover" src="${escapeHtml(album.cover)}" alt="${escapeHtml(album.title)} cover" loading="lazy">
          ${isLocked ? '<div class="lock-overlay" aria-hidden="true"><span class="lock-icon">LOCKED</span></div>' : ""}
        </div>
        <div class="album-content">
          <div class="album-meta">
            <span>${escapeHtml(album.date)}</span>
            <span>${badge}</span>
          </div>
          <h3>${escapeHtml(album.title)}</h3>
          <button class="album-action" type="button" data-album-action="${escapeHtml(album.id)}">${action}</button>
        </div>
      </article>
    `;
  }

  function renderAlbums() {
    const featured = albums.filter(album => album.section === "featured");
    const past = albums.filter(album => album.section === "past");

    els.featured.innerHTML = featured.map(albumCard).join("");
    els.past.innerHTML = past.map(albumCard).join("");
    els.pastEmpty.hidden = past.length > 0;

    document.querySelectorAll("[data-album-action]").forEach(button => {
      button.addEventListener("click", () => handleAlbumAction(button.dataset.albumAction));
    });

    observeReveals();
  }

  async function handleAlbumAction(albumId) {
    const album = albums.find(item => item.id === albumId);
    if (!album) return;

    if (!album.locked) {
      renderGallery(album, Array.isArray(album.images) ? album.images : []);
      setStatus("Free album ready. Add public image URLs in albums.js if you want a free gallery preview.", "neutral");
      return;
    }

    const token = getToken(album.id);
    if (token) {
      await loadAlbumWithToken(album, token);
      return;
    }

    await startCheckout(album);
  }

  async function startCheckout(album) {
    setStatus(`Opening checkout for ${album.title}...`);
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: album.id })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.url) {
      setStatus(payload.error || "Checkout is not ready yet. Check the Stripe price environment variable.", "error");
      return;
    }

    window.location.href = payload.url;
  }

  async function verifyReturnSession() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const albumId = params.get("album");
    const cancelled = params.get("checkout") === "cancelled";

    if (cancelled) {
      setStatus("Checkout cancelled. The album is still locked.", "neutral");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (!sessionId) return;

    const album = albums.find(item => item.id === albumId);
    if (!album) {
      setStatus("Checkout returned for an unknown album.", "error");
      return;
    }

    setStatus("Verifying payment and preparing the gallery...");
    const response = await fetch(`/api/verify-session?session_id=${encodeURIComponent(sessionId)}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.token) {
      setStatus(payload.error || "Payment could not be verified.", "error");
      return;
    }

    setToken(album.id, payload.token);
    renderAlbums();
    renderGallery(album, payload.images || []);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  async function loadAlbumWithToken(album, token) {
    setStatus(`Loading ${album.title}...`);
    const response = await fetch(`/api/album-access?album=${encodeURIComponent(album.id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      clearToken(album.id);
      renderAlbums();
      setStatus(payload.error || "Album access expired. Please unlock again.", "error");
      return;
    }

    renderGallery(album, payload.images || []);
  }

  function renderGallery(album, images) {
    state.openAlbum = album;
    state.images = images;
    els.galleryTitle.textContent = album.title;
    els.galleryMeta.textContent = images.length ? `${album.date} / ${images.length} photos` : `${album.date} / No photos uploaded yet`;

    if (!images.length) {
      els.galleryGrid.innerHTML = '<div class="gallery-empty">No photos are available for this album yet.</div>';
    } else {
      els.galleryGrid.innerHTML = images.map((image, index) => `
        <button class="gallery-tile" type="button" data-image-index="${index}" aria-label="Open photo ${index + 1}">
          <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || `${album.title} photo ${index + 1}`)}" loading="lazy">
        </button>
      `).join("");
    }

    els.gallery.hidden = false;
    els.gallery.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(images.length ? "Gallery unlocked." : "Album unlocked. Photos are not available yet.", "success");

    document.querySelectorAll("[data-image-index]").forEach(button => {
      button.addEventListener("click", () => openLightbox(Number(button.dataset.imageIndex)));
    });
  }

  function openLightbox(index) {
    if (!state.images[index]) return;
    state.index = index;
    updateLightbox();
    els.lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
  }

  function moveLightbox(direction) {
    if (!state.images.length) return;
    state.index = (state.index + direction + state.images.length) % state.images.length;
    updateLightbox();
  }

  function updateLightbox() {
    const image = state.images[state.index];
    els.lightboxImage.src = image.url;
    els.lightboxImage.alt = image.alt || `${state.openAlbum.title} photo ${state.index + 1}`;
    els.lightboxCount.textContent = `${state.index + 1} / ${state.images.length}`;
  }

  function observeReveals() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach(el => el.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });

    document.querySelectorAll(".reveal").forEach(el => observer.observe(el));
  }

  function bindLightbox() {
    els.lightboxClose.addEventListener("click", closeLightbox);
    els.lightboxPrev.addEventListener("click", () => moveLightbox(-1));
    els.lightboxNext.addEventListener("click", () => moveLightbox(1));
    els.lightbox.addEventListener("click", event => {
      if (event.target === els.lightbox) closeLightbox();
    });
    els.lightbox.addEventListener("touchstart", event => {
      state.touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });
    els.lightbox.addEventListener("touchend", event => {
      const delta = event.changedTouches[0].clientX - state.touchStartX;
      if (Math.abs(delta) > 50) moveLightbox(delta > 0 ? -1 : 1);
    }, { passive: true });
    document.addEventListener("keydown", event => {
      if (els.lightbox.hidden) return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") moveLightbox(-1);
      if (event.key === "ArrowRight") moveLightbox(1);
    });
  }

  function init() {
    els.featured = document.getElementById("featured-albums");
    els.past = document.getElementById("past-albums");
    els.pastEmpty = document.getElementById("past-empty");
    els.gallery = document.getElementById("album-gallery");
    els.galleryTitle = document.getElementById("gallery-title");
    els.galleryMeta = document.getElementById("gallery-meta");
    els.galleryGrid = document.getElementById("gallery-grid");
    els.status = document.getElementById("photos-status");
    els.lightbox = document.getElementById("photo-lightbox");
    els.lightboxImage = document.getElementById("lightbox-image");
    els.lightboxCount = document.getElementById("lightbox-count");
    els.lightboxClose = document.getElementById("lightbox-close");
    els.lightboxPrev = document.getElementById("lightbox-prev");
    els.lightboxNext = document.getElementById("lightbox-next");

    renderAlbums();
    bindLightbox();
    verifyReturnSession();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
