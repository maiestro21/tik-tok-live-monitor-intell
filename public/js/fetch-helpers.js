/**
 * Fetch helper functions with credentials included
 */

const API_BASE = '/api';

function fetchWithCredentials(url, options = {}) {
    return fetch(url, {
        ...options,
        credentials: 'include', // Always include credentials for session
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
}

const api = {
    get: async (endpoint) => {
        const response = await fetchWithCredentials(`${API_BASE}${endpoint}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }
        return response.json();
    },
    post: async (endpoint, data) => {
        const response = await fetchWithCredentials(`${API_BASE}${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }
        return response.json();
    },
    put: async (endpoint, data) => {
        const response = await fetchWithCredentials(`${API_BASE}${endpoint}`, {
            method: 'PUT',
            body: data ? JSON.stringify(data) : undefined
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }
        return response.json();
    },
    delete: async (endpoint) => {
        const response = await fetchWithCredentials(`${API_BASE}${endpoint}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }
        return response.json();
    }
};

async function logout() {
    try {
        await fetchWithCredentials('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (error) {
        // Still redirect even if logout request fails
        window.location.href = '/login';
    }
}

// Make available globally
window.api = api;
window.logout = logout;
