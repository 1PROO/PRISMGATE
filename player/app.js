/**
 * PrismGate TV Player - IPTV Web Player
 * Works on any Smart TV browser (LG webOS, Samsung Tizen, Android TV)
 * Supports Xtream Codes API for live TV streaming
 */

// ═══════ STATE ═══════
let STATE = {
  server: "",
  username: "",
  password: "",
  categories: [],
  channels: [],
  filteredChannels: [],
  activeCategory: null,
  activeChannel: null,
  hlsInstance: null,
  fsHlsInstance: null,
  fsOverlayTimer: null,
  mode: "live", // "live", "movies", "series"
  selectedSeries: null,
  selectedSeason: null,
  activeEpisodes: null,
};

// ═══════ DOM ELEMENTS ═══════
const $ = (id) => document.getElementById(id);

const DOM = {
  loginScreen: $("login-screen"),
  selectionScreen: $("selection-screen"),
  mainScreen: $("main-screen"),
  loginForm: $("login-form"),
  username: $("username"),
  password: $("password"),
  loginError: $("login-error"),
  loadingOverlay: $("loading-overlay"),
  categoryList: $("category-list"),
  channelList: $("channel-list"),
  categoryTitle: $("category-title"),
  channelCount: $("channel-count"),
  videoPlayer: $("video-player"),
  playerOverlay: $("player-overlay"),
  playerLoading: $("player-loading"),
  playerError: $("player-error"),
  playerErrorMsg: $("player-error-msg"),
  btnRetry: $("btn-retry"),
  btnLogout: $("btn-logout"),
  btnHome: $("btn-home"),
  nowPlaying: $("now-playing"),
  clock: $("clock"),
  fullscreenPlayer: $("fullscreen-player"),
  fsVideoPlayer: $("fs-video-player"),
  fsOverlay: $("fs-overlay"),
  fsTitle: $("fs-title"),
  fsBack: $("fs-back"),
  fsClock: $("fs-clock"),
  btnSelectLive: $("btn-select-live"),
  btnSelectMovies: $("btn-select-movies"),
  btnSelectSeries: $("btn-select-series"),
  btnLogoutSelect: $("btn-logout-select"),
};

// ═══════ UTILS ═══════
function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  if (DOM.clock) DOM.clock.textContent = t;
  if (DOM.fsClock) DOM.fsClock.textContent = t;
}
setInterval(updateClock, 1000);
updateClock();

function saveCredentials() {
  try {
    localStorage.setItem("prismgate_tv", JSON.stringify({
      username: STATE.username,
      password: STATE.password,
    }));
  } catch (e) { /* ignore */ }
}

function loadCredentials() {
  try {
    const data = JSON.parse(localStorage.getItem("prismgate_tv"));
    if (data && data.username && data.password) {
      return data;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ═══════ API ═══════
async function apiCall(action = "") {
  let url = `${STATE.server}/player_api.php?username=${encodeURIComponent(STATE.username)}&password=${encodeURIComponent(STATE.password)}`;
  if (action) url += `&action=${action}`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return await res.json();
}

async function authenticate() {
  const data = await apiCall();
  if (!data || !data.user_info || data.user_info.auth !== 1) {
    throw new Error("Invalid credentials");
  }
  return data;
}

async function getCategories() {
  let action = "get_live_categories";
  if (STATE.mode === "movies") action = "get_vod_categories";
  else if (STATE.mode === "series") action = "get_series_categories";
  return await apiCall(action);
}

async function getStreams(categoryId) {
  let action = "get_live_streams";
  if (STATE.mode === "movies") {
    action = "get_vod_streams";
  } else if (STATE.mode === "series") {
    action = "get_series";
  }
  if (categoryId) action += `&category_id=${categoryId}`;
  return await apiCall(action);
}

function buildStreamUrl(streamId, ext = "m3u8") {
  // Force the stream to go directly to the IPTV provider server over HTTP
  const actualStreamServer = "http://mhav1.com:2095";
  let type = "live";
  if (STATE.mode === "movies") type = "movie";
  else if (STATE.mode === "series") type = "series";
  return `${actualStreamServer}/${type}/${encodeURIComponent(STATE.username)}/${encodeURIComponent(STATE.password)}/${streamId}.${ext}`;
}

// ═══════ NAVIGATION ═══════
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(screenId).classList.add("active");
}

// ═══════ LOGIN ═══════
DOM.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  DOM.loginError.textContent = "";

  const user = DOM.username.value.trim();
  const pass = DOM.password.value.trim();

  if (!user || !pass) {
    DOM.loginError.textContent = "Please fill in all fields";
    return;
  }

  STATE.server = window.location.origin;
  STATE.username = user;
  STATE.password = pass;

  // Disable form
  const btn = DOM.loginForm.querySelector("button");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;display:inline-block"></div> Connecting...';

  try {
    await authenticate();
    saveCredentials();
    showScreen("selection-screen");
  } catch (err) {
    DOM.loginError.textContent = err.message || "Connection failed. Check your credentials.";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Connect';
  }
});

// ═══════ MAIN SCREEN ═══════
async function loadMainScreen() {
  showScreen("main-screen");
  DOM.loadingOverlay.style.display = "flex";

  try {
    const cats = await getCategories();
    STATE.categories = Array.isArray(cats) ? cats : [];

    // Get all streams initially
    const streams = await getStreams("");
    STATE.channels = Array.isArray(streams) ? streams : [];
    STATE.filteredChannels = STATE.channels;

    renderCategories();
    renderChannels();
  } catch (err) {
    console.error("Failed to load data:", err);
  } finally {
    DOM.loadingOverlay.style.display = "none";
  }
}

// ═══════ CATEGORIES ═══════
function renderCategories() {
  let html = "";
  let catIcon = "bi-folder2";
  let allLabel = "الكل";
  
  if (STATE.mode === "movies") {
    catIcon = "bi-film";
    allLabel = "كل الأفلام";
  } else if (STATE.mode === "series") {
    catIcon = "bi-collection-play";
    allLabel = "كل المسلسلات";
  } else {
    allLabel = "كل القنوات";
  }

  // "All" option
  html += `<button class="cat-item active" data-id="" tabindex="10">
    <i class="bi bi-collection-play"></i>
    <span>${allLabel} (${STATE.channels.length})</span>
  </button>`;

  STATE.categories.forEach((cat, i) => {
    const count = STATE.channels.filter(ch => ch.category_id === String(cat.category_id)).length;
    html += `<button class="cat-item" data-id="${escapeHtml(String(cat.category_id))}" tabindex="${11 + i}">
      <i class="bi ${catIcon}"></i>
      <span>${escapeHtml(cat.category_name)} (${count})</span>
    </button>`;
  });

  DOM.categoryList.innerHTML = html;

  // Add click handlers
  DOM.categoryList.querySelectorAll(".cat-item").forEach(btn => {
    btn.addEventListener("click", () => selectCategory(btn.dataset.id));
  });
}

function selectCategory(categoryId) {
  STATE.activeCategory = categoryId || null;

  // Update active state
  DOM.categoryList.querySelectorAll(".cat-item").forEach(b => b.classList.remove("active"));
  const activeBtn = DOM.categoryList.querySelector(`.cat-item[data-id="${categoryId || ""}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  // Filter channels
  let allLabel = "كل القنوات";
  if (STATE.mode === "movies") allLabel = "كل الأفلام";
  else if (STATE.mode === "series") allLabel = "كل المسلسلات";

  if (!categoryId) {
    STATE.filteredChannels = STATE.channels;
    DOM.categoryTitle.textContent = allLabel;
  } else {
    STATE.filteredChannels = STATE.channels.filter(ch => String(ch.category_id) === String(categoryId));
    const cat = STATE.categories.find(c => String(c.category_id) === String(categoryId));
    DOM.categoryTitle.textContent = cat ? cat.category_name : allLabel;
  }

  renderChannels();
}

// ═══════ CHANNELS ═══════
function renderChannels() {
  const list = STATE.filteredChannels;
  let countLabel = "قناة";
  if (STATE.mode === "movies") countLabel = "فيلم";
  else if (STATE.mode === "series") countLabel = "مسلسل";
  
  DOM.channelCount.textContent = `${list.length} ${countLabel}`;

  if (list.length === 0) {
    DOM.channelList.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)"><i class="bi bi-inbox" style="font-size:32px;display:block;margin-bottom:8px"></i>لا يوجد محتوى</div>';
    return;
  }

  let html = "";
  list.forEach((ch, i) => {
    const logoUrl = ch.cover || ch.stream_icon;
    const logo = logoUrl ? `<img class="ch-logo" src="${escapeHtml(logoUrl)}" alt="" onerror="this.style.display='none'" loading="lazy">` : "";
    html += `<button class="ch-item${STATE.activeChannel && (STATE.activeChannel.stream_id === ch.stream_id || STATE.activeChannel.series_id === ch.series_id) ? " active" : ""}" data-index="${i}" tabindex="${200 + i}">
      <span class="ch-num">${ch.num || (i + 1)}</span>
      ${logo}
      <span class="ch-name">${escapeHtml(ch.name || "Unknown")}</span>
    </button>`;
  });

  DOM.channelList.innerHTML = html;

  // Add click handlers
  DOM.channelList.querySelectorAll(".ch-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index);
      const item = STATE.filteredChannels[idx];
      if (STATE.mode === "series") {
        loadSeriesEpisodes(item);
      } else {
        playChannel(item);
      }
    });

    // Double-click for fullscreen
    btn.addEventListener("dblclick", () => {
      const idx = parseInt(btn.dataset.index);
      const item = STATE.filteredChannels[idx];
      if (STATE.mode !== "series") {
        playChannel(item);
        enterFullscreen();
      }
    });
  });
}

function playChannel(channel) {
  if (!channel) return;

  STATE.activeChannel = channel;

  // Update channel list active state
  DOM.channelList.querySelectorAll(".ch-item").forEach(b => b.classList.remove("active"));
  const activeIdx = STATE.filteredChannels.indexOf(channel);
  const activeBtn = DOM.channelList.querySelector(`.ch-item[data-index="${activeIdx}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  // Update now playing
  DOM.nowPlaying.innerHTML = `<span class="now-label playing"><i class="bi bi-broadcast"></i> ${escapeHtml(channel.name || "Unknown")}</span>`;

  // Show loading
  DOM.playerOverlay.style.display = "none";
  DOM.playerLoading.style.display = "flex";
  DOM.playerError.style.display = "none";

  // Build stream URL
  const ext = STATE.mode === "movies" ? (channel.container_extension || "mp4") : "m3u8";
  const streamUrl = buildStreamUrl(channel.stream_id, ext);

  loadStream(DOM.videoPlayer, streamUrl, "main");
}

function loadStream(videoEl, url, instanceKey) {
  // Cleanup previous HLS instance
  const hlsKey = instanceKey === "main" ? "hlsInstance" : "fsHlsInstance";
  if (STATE[hlsKey]) {
    STATE[hlsKey].destroy();
    STATE[hlsKey] = null;
  }

  // Only load with Hls.js if it is an m3u8 playlist
  const isHlsUrl = url.includes(".m3u8") || url.includes("m3u8");

  if (Hls && Hls.isSupported() && isHlsUrl) {
    const hls = new Hls({
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
      startLevel: -1,
      enableWorker: false, // Some Smart TV browsers don't support Workers
    });
    STATE[hlsKey] = hls;

    hls.loadSource(url);
    hls.attachMedia(videoEl);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch(() => {});
      DOM.playerLoading.style.display = "none";
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error("HLS Error:", data);
      if (data.fatal) {
        // Try .ts fallback
        if (url.endsWith(".m3u8") && STATE.activeChannel) {
          const tsUrl = buildStreamUrl(STATE.activeChannel.stream_id, "ts");
          loadDirectStream(videoEl, tsUrl);
        } else {
          showPlayerError("Stream unavailable. Try another channel.");
        }
      }
    });
  } else if (videoEl.canPlayType("application/vnd.apple.mpegurl") && isHlsUrl) {
    // Native HLS support (Safari, some Smart TVs)
    videoEl.src = url;
    videoEl.addEventListener("loadedmetadata", () => {
      videoEl.play().catch(() => {});
      DOM.playerLoading.style.display = "none";
    }, { once: true });

    videoEl.addEventListener("error", () => {
      if (url.endsWith(".m3u8") && STATE.activeChannel) {
        const tsUrl = buildStreamUrl(STATE.activeChannel.stream_id, "ts");
        loadDirectStream(videoEl, tsUrl);
      } else {
        showPlayerError("Stream unavailable.");
      }
    }, { once: true });
  } else {
    // Fallback: try direct stream (MP4, MKV, TS)
    loadDirectStream(videoEl, url);
  }
}

function loadDirectStream(videoEl, url) {
  videoEl.src = url;
  videoEl.play().then(() => {
    DOM.playerLoading.style.display = "none";
  }).catch(() => {
    showPlayerError("Stream format not supported on this device.");
  });
}

function showPlayerError(msg) {
  DOM.playerLoading.style.display = "none";
  DOM.playerError.style.display = "flex";
  DOM.playerErrorMsg.textContent = msg;
}

DOM.btnRetry.addEventListener("click", () => {
  if (STATE.activeChannel) playChannel(STATE.activeChannel);
});

// ═══════ FULLSCREEN ═══════
function enterFullscreen() {
  if (!STATE.activeChannel) return;

  DOM.fullscreenPlayer.style.display = "block";
  DOM.fsTitle.textContent = STATE.activeChannel.name || "Unknown";

  const streamUrl = buildStreamUrl(STATE.activeChannel.stream_id, "m3u8");
  loadStream(DOM.fsVideoPlayer, streamUrl, "fs");

  // Show overlay briefly
  showFsOverlay();
}

function exitFullscreen() {
  DOM.fullscreenPlayer.style.display = "none";
  if (STATE.fsHlsInstance) {
    STATE.fsHlsInstance.destroy();
    STATE.fsHlsInstance = null;
  }
  DOM.fsVideoPlayer.src = "";
}

function showFsOverlay() {
  DOM.fsOverlay.classList.add("visible");
  clearTimeout(STATE.fsOverlayTimer);
  STATE.fsOverlayTimer = setTimeout(() => {
    DOM.fsOverlay.classList.remove("visible");
  }, 4000);
}

DOM.fsBack.addEventListener("click", exitFullscreen);

// Show overlay on mouse/touch activity in fullscreen
DOM.fullscreenPlayer.addEventListener("mousemove", showFsOverlay);
DOM.fullscreenPlayer.addEventListener("click", (e) => {
  if (e.target === DOM.fsVideoPlayer || e.target === DOM.fullscreenPlayer) {
    showFsOverlay();
  }
});

// Double-click video player to enter fullscreen
DOM.videoPlayer.addEventListener("dblclick", enterFullscreen);

// ═══════ KEYBOARD NAVIGATION (TV Remote) ═══════
document.addEventListener("keydown", (e) => {
  // Handle Escape / Back button
  if (e.key === "Escape" || e.key === "GoBack" || e.keyCode === 461 /* LG Back */) {
    if (DOM.fullscreenPlayer.style.display === "block") {
      exitFullscreen();
      e.preventDefault();
    }
  }

  // F key for fullscreen
  if (e.key === "f" || e.key === "F") {
    if (STATE.activeChannel && DOM.fullscreenPlayer.style.display !== "block") {
      enterFullscreen();
    }
  }
});

// ═══════ LOGOUT ═══════
function logout() {
  // Cleanup
  if (STATE.hlsInstance) { STATE.hlsInstance.destroy(); STATE.hlsInstance = null; }
  if (STATE.fsHlsInstance) { STATE.fsHlsInstance.destroy(); STATE.fsHlsInstance = null; }
  DOM.videoPlayer.src = "";
  DOM.fsVideoPlayer.src = "";
  DOM.fullscreenPlayer.style.display = "none";
  DOM.nowPlaying.innerHTML = '<span class="now-label">Ready</span>';

  STATE.channels = [];
  STATE.categories = [];
  STATE.filteredChannels = [];
  STATE.activeChannel = null;
  STATE.activeCategory = null;
  STATE.selectedSeries = null;
  STATE.selectedSeason = null;
  STATE.activeEpisodes = null;

  try { localStorage.removeItem("prismgate_tv"); } catch (e) {}

  showScreen("login-screen");
  DOM.loginError.textContent = "";
}

DOM.btnLogout.addEventListener("click", logout);

// ═══════ SELECTION SCREEN EVENTS ═══════
DOM.btnSelectLive.addEventListener("click", () => {
  STATE.mode = "live";
  loadMainScreen();
});

DOM.btnSelectMovies.addEventListener("click", () => {
  STATE.mode = "movies";
  loadMainScreen();
});

DOM.btnSelectSeries.addEventListener("click", () => {
  STATE.mode = "series";
  loadMainScreen();
});

DOM.btnLogoutSelect.addEventListener("click", logout);

DOM.btnHome.addEventListener("click", () => {
  // Stop playing
  if (STATE.hlsInstance) { STATE.hlsInstance.destroy(); STATE.hlsInstance = null; }
  if (STATE.fsHlsInstance) { STATE.fsHlsInstance.destroy(); STATE.fsHlsInstance = null; }
  DOM.videoPlayer.src = "";
  DOM.fsVideoPlayer.src = "";
  DOM.fullscreenPlayer.style.display = "none";
  DOM.nowPlaying.innerHTML = '<span class="now-label">Ready</span>';
  
  STATE.activeChannel = null;
  STATE.selectedSeries = null;
  STATE.selectedSeason = null;
  STATE.activeEpisodes = null;

  showScreen("selection-screen");
});

// ═══════ SERIES SEASONS & EPISODES ═══════
async function loadSeriesEpisodes(series) {
  STATE.selectedSeries = series;
  DOM.loadingOverlay.style.display = "flex";
  try {
    const info = await apiCall(`get_series_info&series_id=${series.series_id}`);
    DOM.loadingOverlay.style.display = "none";
    if (info && info.episodes) {
      renderEpisodes(info.episodes);
    } else {
      alert("لا توجد حلقات متاحة لهذا المسلسل");
    }
  } catch (err) {
    DOM.loadingOverlay.style.display = "none";
    console.error("Failed to load series info:", err);
    alert("فشل في تحميل حلقات المسلسل");
  }
}

function renderEpisodes(episodesObj) {
  const seasons = Object.keys(episodesObj).sort((a, b) => parseInt(a) - parseInt(b));
  if (seasons.length === 0) {
    DOM.channelList.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">لا توجد حلقات</div>';
    return;
  }

  STATE.activeEpisodes = episodesObj;
  STATE.selectedSeason = seasons[0];
  
  renderSeasonEpisodes();
}

function renderSeasonEpisodes() {
  const season = STATE.selectedSeason;
  const list = STATE.activeEpisodes[season] || [];
  
  let seasonsHtml = "";
  const seasons = Object.keys(STATE.activeEpisodes).sort((a, b) => parseInt(a) - parseInt(b));
  if (seasons.length > 1) {
    seasonsHtml = `<select id="season-selector" class="season-select" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-family:var(--font);font-size:12px;outline:none;">`;
    seasons.forEach(s => {
      seasonsHtml += `<option value="${s}" ${s === season ? "selected" : ""}>الموسم ${s}</option>`;
    });
    seasonsHtml += `</select>`;
  } else {
    seasonsHtml = `<span class="channel-count">الموسم ${season}</span>`;
  }

  DOM.categoryTitle.innerHTML = `<button class="btn-back-series" id="btn-back-series"><i class="bi bi-arrow-right"></i> ${escapeHtml(STATE.selectedSeries.name)}</button>`;
  DOM.channelCount.innerHTML = seasonsHtml;

  document.getElementById("btn-back-series").addEventListener("click", () => {
    STATE.selectedSeries = null;
    STATE.selectedSeason = null;
    STATE.activeEpisodes = null;
    selectCategory(STATE.activeCategory);
  });

  const selector = document.getElementById("season-selector");
  if (selector) {
    selector.addEventListener("change", (e) => {
      STATE.selectedSeason = e.target.value;
      renderSeasonEpisodes();
    });
  }

  if (list.length === 0) {
    DOM.channelList.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">لا توجد حلقات في هذا الموسم</div>';
    return;
  }

  let html = "";
  list.forEach((ep, i) => {
    const logoUrl = ep.info && ep.info.movie_image ? ep.info.movie_image : "";
    const logo = logoUrl ? `<img class="ch-logo" src="${escapeHtml(logoUrl)}" alt="" onerror="this.style.display='none'" loading="lazy">` : "";
    html += `<button class="ch-item" data-index="${i}" id="ep-item-${i}">
      <span class="ch-num">${ep.episode_num || (i + 1)}</span>
      ${logo}
      <span class="ch-name">${escapeHtml(ep.title || `الحلقة ${i+1}`)}</span>
    </button>`;
  });

  DOM.channelList.innerHTML = html;

  DOM.channelList.querySelectorAll(".ch-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index);
      playEpisode(list[idx]);
    });
  });
}

function playEpisode(episode) {
  if (!episode) return;
  STATE.activeChannel = episode;

  DOM.channelList.querySelectorAll(".ch-item").forEach(b => b.classList.remove("active"));
  const episodeIndex = STATE.activeEpisodes[STATE.selectedSeason].indexOf(episode);
  const activeBtn = document.getElementById(`ep-item-${episodeIndex}`);
  if (activeBtn) activeBtn.classList.add("active");

  DOM.nowPlaying.innerHTML = `<span class="now-label playing"><i class="bi bi-broadcast"></i> ${escapeHtml(STATE.selectedSeries.name)} - ${escapeHtml(episode.title)}</span>`;

  DOM.playerOverlay.style.display = "none";
  DOM.playerLoading.style.display = "flex";
  DOM.playerError.style.display = "none";

  const ext = episode.container_extension || "mp4";
  const streamUrl = buildStreamUrl(episode.id, ext);

  loadStream(DOM.videoPlayer, streamUrl, "main");
}

// ═══════ AUTO-LOGIN ═══════
(async function init() {
  const saved = loadCredentials();
  if (saved) {
    DOM.username.value = saved.username;
    DOM.password.value = saved.password;

    STATE.server = window.location.origin;
    STATE.username = saved.username;
    STATE.password = saved.password;

    try {
      await authenticate();
      showScreen("selection-screen");
      return;
    } catch (e) {
      console.log("Auto-login failed:", e);
    }
  }
  showScreen("login-screen");
})();
