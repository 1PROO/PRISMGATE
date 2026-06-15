/**
 * PrismGate Admin Dashboard Logic
 */

// Hardcoded API URL pointing to the deployed Worker
const API_URL = "https://prismgate-admin-api.ahmedakram19.workers.dev";

let USERS_CACHE = [];
let bootstrapUserModal = null;
let bootstrapToast = null;

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Bootstrap Modals and Toasts
  bootstrapUserModal = new bootstrap.Modal(document.getElementById("userModal"));
  bootstrapToast = new bootstrap.Toast(document.getElementById("liveToast"), { delay: 4000 });

  // Check LocalStorage for the Admin Secret Key
  const storedSecret = localStorage.getItem("prismgate_admin_secret");

  if (storedSecret) {
    showDashboard(storedSecret);
  } else {
    // Show auth screen
    document.getElementById("auth-screen").classList.remove("d-none");
  }

  // Setup Event Listeners
  setupEventListeners();
});

function setupEventListeners() {
  // Login Form
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const secretKey = document.getElementById("secret-key-input").value.trim();

    const submitBtn = e.target.querySelector("button[type='submit']");
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Validating...';
    submitBtn.disabled = true;

    // Test API connection
    try {
      const response = await fetch(`${API_URL}/api/users`, {
        method: "GET",
        headers: {
          "X-Admin-Secret": secretKey
        }
      });

      if (response.ok) {
        // Save only secret to local storage
        localStorage.setItem("prismgate_admin_secret", secretKey);
        
        // Hide login and show dashboard
        document.getElementById("auth-screen").classList.add("d-none");
        showDashboard(secretKey);
        showToast("Success", "Authentication successful. Access granted.", "check-circle-fill", "text-success");
      } else {
        const errData = await response.json().catch(() => ({}));
        alert(`Authentication failed: ${errData.error || response.statusText || 'Invalid secret key'}`);
      }
    } catch (err) {
      console.error(err);
      alert(`Network error: Failed to connect to Admin API. Please check your URL and verify CORS. Error: ${err.message}`);
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
    }
  });

  // Logout Button
  document.getElementById("logout-btn").addEventListener("click", () => {
    if (confirm("Are you sure you want to log out?")) {
      localStorage.removeItem("prismgate_admin_secret");
      document.getElementById("dashboard").classList.add("d-none");
      document.getElementById("auth-screen").classList.remove("d-none");
      // Clear inputs
      document.getElementById("secret-key-input").value = "";
    }
  });

  // Search Input (Local Filtering)
  document.getElementById("search-input").addEventListener("input", filterUsers);

  // Refresh Table Button
  document.getElementById("refresh-btn").addEventListener("click", () => {
    fetchUsers();
  });

  // Password Generator Button
  document.getElementById("gen-password-btn").addEventListener("click", () => {
    document.getElementById("form-password").value = generateRandomPassword(12);
  });

  // Modal Reset on Show (Add Mode)
  document.getElementById("add-user-btn-trigger").addEventListener("click", () => {
    document.getElementById("userModalLabel").innerText = "Add Client Account";
    document.getElementById("form-action").value = "add";
    document.getElementById("form-username").value = "";
    document.getElementById("form-username").disabled = false;
    document.getElementById("username-help-text").innerText = "Choose a unique client login name.";
    document.getElementById("form-password").value = generateRandomPassword(12);
    document.getElementById("form-origin-host").value = "";
    document.getElementById("form-origin-username").value = "";
    document.getElementById("form-origin-password").value = "";
    document.getElementById("modal-error-alert").classList.add("d-none");
    document.getElementById("form-submit-btn").innerText = "Create Account";
  });

  // Form Submission (Add or Edit)
  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const action = document.getElementById("form-action").value;
    const username = document.getElementById("form-username").value.trim();
    const password = document.getElementById("form-password").value.trim();
    const origin_host = document.getElementById("form-origin-host").value.trim();
    const origin_username = document.getElementById("form-origin-username").value.trim();
    const origin_password = document.getElementById("form-origin-password").value.trim();

    const secret = localStorage.getItem("prismgate_admin_secret");
    const errorAlert = document.getElementById("modal-error-alert");

    errorAlert.classList.add("d-none");
    const submitBtn = document.getElementById("form-submit-btn");
    const originalText = submitBtn.innerText;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Saving...';
    submitBtn.disabled = true;

    try {
      const response = await fetch(`${API_URL}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": secret
        },
        body: JSON.stringify({ username, password, origin_host, origin_username, origin_password })
      });

      const resData = await response.json().catch(() => ({}));
      if (response.ok) {
        bootstrapUserModal.hide();
        showToast(
          "Success", 
          `Client account for "${username}" has been ${action === "add" ? "created" : "updated"} successfully.`, 
          "check-circle-fill", 
          "text-success"
        );
        
        // Optimistically update local cache & UI
        const updatedUser = {
          username,
          password,
          origin_host,
          origin_username,
          origin_password,
          status: "active"
        };
        const existingIdx = USERS_CACHE.findIndex(u => u.username === username);
        if (existingIdx > -1) {
          USERS_CACHE[existingIdx] = updatedUser;
        } else {
          USERS_CACHE.push(updatedUser);
        }

        const query = document.getElementById("search-input").value.trim().toLowerCase();
        if (query) {
          filterUsers();
        } else {
          renderUserTable(USERS_CACHE);
        }
        calculateStats(USERS_CACHE);

        // Silent background sync after 1.5 seconds to align with KV
        setTimeout(() => fetchUsers(true), 1500);
      } else {
        errorAlert.innerText = resData.error || "Failed to save user account.";
        errorAlert.classList.remove("d-none");
      }
    } catch (err) {
      errorAlert.innerText = `Network Error: ${err.message}`;
      errorAlert.classList.remove("d-none");
    } finally {
      submitBtn.innerText = originalText;
      submitBtn.disabled = false;
    }
  });

  // PWA Install Event Listeners
  let deferredPrompt = null;
  const installBtn = document.getElementById("install-pwa-btn");
  
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) {
      installBtn.classList.remove("d-none");
    }
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      // Check if it's iOS
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        const iosModal = new bootstrap.Modal(document.getElementById("iosInstallModal"));
        iosModal.show();
        return;
      }

      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User choice to install: ${outcome}`);
        deferredPrompt = null;
        installBtn.classList.add("d-none");
      }
    });
  }

  // Handle iOS direct check on load
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isIOS && !isStandalone && installBtn) {
    installBtn.innerHTML = '<i class="bi bi-apple me-1"></i> Install App';
    installBtn.classList.remove("d-none");
  }
}

function showDashboard(secretKey) {
  document.getElementById("auth-screen").classList.add("d-none");
  document.getElementById("dashboard").classList.remove("d-none");
  fetchUsers();
}

async function fetchUsers(silent = false) {
  const secret = localStorage.getItem("prismgate_admin_secret");
  const tbody = document.getElementById("user-table-body");

  if (!silent) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-5">
          <div class="spinner-border text-primary-glow" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <p class="text-white-50 mt-2 m-0">Fetching client records...</p>
        </td>
      </tr>
    `;
  }

  try {
    const response = await fetch(`${API_URL}/api/users`, {
      method: "GET",
      headers: {
        "X-Admin-Secret": secret
      }
    });

    if (response.ok) {
      const data = await response.json();
      USERS_CACHE = data;
      const query = document.getElementById("search-input").value.trim().toLowerCase();
      if (query) {
        filterUsers();
      } else {
        renderUserTable(USERS_CACHE);
      }
      calculateStats(USERS_CACHE);
    } else if (!silent) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-danger py-4">
            <i class="bi bi-exclamation-triangle-fill fs-2 d-block mb-2 text-danger-glow"></i>
            Error loading records: ${response.statusText} (${response.status})
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error(err);
    if (!silent) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-danger py-4">
            <i class="bi bi-exclamation-triangle-fill fs-2 d-block mb-2 text-danger-glow"></i>
            Failed to connect to Admin API. Check URL and connection.
          </td>
        </tr>
      `;
    }
  }
}

function renderUserTable(users) {
  const tbody = document.getElementById("user-table-body");
  
  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-white-50 py-4">No client records found.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = "";
  users.forEach((user, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="fw-semibold"><i class="bi bi-person-circle text-white-50 me-2"></i> ${escapeHtml(user.username)}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <span class="password-masked" id="pass-mask-${index}">••••••••</span>
          <span class="password-raw d-none" id="pass-raw-${index}">${escapeHtml(user.password)}</span>
          <button class="btn btn-link p-0 text-white-50 border-0" onclick="togglePasswordVisibility(${index})">
            <i class="bi bi-eye" id="pass-icon-${index}"></i>
          </button>
        </div>
      </td>
      <td>
        <span class="text-white">${escapeHtml(user.origin_host)}</span>
        <span class="badge bg-secondary bg-opacity-25 text-white-50 ms-2" title="Origin Username">${escapeHtml(user.origin_username)}</span>
      </td>
      <td><span class="badge badge-status badge-active">Active</span></td>
      <td class="text-end">
        <button class="btn btn-secondary-glow btn-sm me-2" onclick="editUser('${escapeHtml(user.username)}')">
          <i class="bi bi-pencil"></i> Edit
        </button>
        <button class="btn btn-danger-glow btn-sm" onclick="deleteUser('${escapeHtml(user.username)}')">
          <i class="bi bi-trash"></i> Delete
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function calculateStats(users) {
  const total = users.length;

  const uniqueHosts = new Set(users.map(u => u.origin_host).filter(Boolean));

  document.getElementById("stat-total-users").innerText = total;
  document.getElementById("stat-active-users").innerText = total;
  document.getElementById("stat-servers").innerText = uniqueHosts.size;
}

function filterUsers() {
  const query = document.getElementById("search-input").value.trim().toLowerCase();

  const filtered = USERS_CACHE.filter(user => {
    return user.username.toLowerCase().includes(query);
  });

  renderUserTable(filtered);
}

window.togglePasswordVisibility = function(index) {
  const mask = document.getElementById(`pass-mask-${index}`);
  const raw = document.getElementById(`pass-raw-${index}`);
  const icon = document.getElementById(`pass-icon-${index}`);

  if (raw.classList.contains("d-none")) {
    raw.classList.remove("d-none");
    mask.classList.add("d-none");
    icon.classList.replace("bi-eye", "bi-eye-slash");
  } else {
    raw.classList.add("d-none");
    mask.classList.remove("d-none");
    icon.classList.replace("bi-eye-slash", "bi-eye");
  }
};

window.editUser = function(username) {
  const user = USERS_CACHE.find(u => u.username === username);
  if (!user) return;

  document.getElementById("userModalLabel").innerText = "Edit Client Account";
  document.getElementById("form-action").value = "edit";
  
  const userField = document.getElementById("form-username");
  userField.value = user.username;
  userField.disabled = true; // Lock username during edit (KV lookup key)
  
  document.getElementById("username-help-text").innerText = "Username cannot be changed (create a new account instead).";
  document.getElementById("form-password").value = user.password;
  document.getElementById("form-origin-host").value = user.origin_host || "";
  document.getElementById("form-origin-username").value = user.origin_username || "";
  document.getElementById("form-origin-password").value = user.origin_password || "";

  document.getElementById("modal-error-alert").classList.add("d-none");
  document.getElementById("form-submit-btn").innerText = "Save Changes";
  
  bootstrapUserModal.show();
};

window.deleteUser = async function(username) {
  if (!confirm(`Are you sure you want to permanently delete client account "${username}"?`)) {
    return;
  }

  const secret = localStorage.getItem("prismgate_admin_secret");

  // Save state for rollback
  const previousCache = [...USERS_CACHE];
  
  // Optimistically remove from cache and update UI immediately
  USERS_CACHE = USERS_CACHE.filter(u => u.username !== username);
  
  const query = document.getElementById("search-input").value.trim().toLowerCase();
  if (query) {
    filterUsers();
  } else {
    renderUserTable(USERS_CACHE);
  }
  calculateStats(USERS_CACHE);

  try {
    const response = await fetch(`${API_URL}/api/users?username=${encodeURIComponent(username)}`, {
      method: "DELETE",
      headers: {
        "X-Admin-Secret": secret
      }
    });

    if (response.ok) {
      showToast("Deleted", `Client "${username}" deleted.`, "trash-fill", "text-danger");
      // Silent background sync after 1.5 seconds to align with KV
      setTimeout(() => fetchUsers(true), 1500);
    } else {
      // Revert cache & UI if failed
      USERS_CACHE = previousCache;
      if (query) {
        filterUsers();
      } else {
        renderUserTable(USERS_CACHE);
      }
      calculateStats(USERS_CACHE);

      const err = await response.json().catch(() => ({}));
      alert(`Error: ${err.error || response.statusText}`);
    }
  } catch (err) {
    // Revert cache & UI if failed
    USERS_CACHE = previousCache;
    if (query) {
      filterUsers();
    } else {
      renderUserTable(USERS_CACHE);
    }
    calculateStats(USERS_CACHE);

    alert(`Failed to delete client: ${err.message}`);
  }
};

// Helpers
function generateRandomPassword(length = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(title, message, iconName = "info-circle-fill", textClass = "text-primary-glow") {
  document.getElementById("toast-icon").className = `bi bi-${iconName} ${textClass}`;
  document.getElementById("toast-message").innerText = message;
  bootstrapToast.show();
}

window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Copied", `"${text}" copied to clipboard!`, "check-circle-fill", "text-success");
  }).catch(() => {
    alert("Failed to copy to clipboard.");
  });
};
