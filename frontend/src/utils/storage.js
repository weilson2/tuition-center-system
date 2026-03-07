
export const storage = {
  // Get item from either localStorage or sessionStorage
  getItem: (key) => {
    // Check localStorage first (persistent)
    let value = localStorage.getItem(key);
    if (value) return value;
    
    // Check sessionStorage (session only)
    value = sessionStorage.getItem(key);
    return value;
  },

  // Set item based on Remember Me preference
  setItem: (key, value, remember = false) => {
    if (remember) {
      localStorage.setItem(key, value);
      sessionStorage.removeItem(key); // Clear from session
    } else {
      sessionStorage.setItem(key, value);
      localStorage.removeItem(key); // Clear from persistent
    }
  },

  // Remove item from both storages
  removeItem: (key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },

  // Clear all auth data
  clearAuth: () => {
    // Clear from both storages
    ['token', 'user', 'rememberMe'].forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  },

  // Check if Remember Me is active
  isRememberMe: () => {
    return localStorage.getItem('rememberMe') === 'true';
  }
};