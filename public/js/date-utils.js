/**
 * Date formatting utilities
 * All dates should be displayed as dd/mm/yyyy format
 */

/**
 * Format a date to dd/mm/yyyy format
 * @param {Date|string|number} date - Date object, ISO string, or Unix timestamp (seconds or milliseconds)
 * @returns {string} Formatted date as dd/mm/yyyy or 'N/A' if invalid
 */
function formatDate(date) {
    if (!date) return 'N/A';
    
    let dateObj;
    
    // Handle different input types
    if (date instanceof Date) {
        dateObj = date;
    } else if (typeof date === 'string') {
        // ISO string or date string
        dateObj = new Date(date);
    } else if (typeof date === 'number') {
        // Unix timestamp - check if it's in seconds (< year 2100 in seconds) or milliseconds
        // Unix timestamp for year 2000 in seconds: 946684800
        // Unix timestamp for year 2100 in seconds: 4102444800
        // If number is less than 10000000000, it's likely in seconds (before year 2286)
        if (date < 10000000000) {
            // Unix timestamp in seconds, convert to milliseconds
            dateObj = new Date(date * 1000);
        } else {
            // Unix timestamp in milliseconds
            dateObj = new Date(date);
        }
    } else {
        return 'N/A';
    }
    
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
        return 'N/A';
    }
    
    // Format as dd/mm/yyyy
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    
    return `${day}/${month}/${year}`;
}

/**
 * Format a date with time to dd/mm/yyyy HH:MM:SS format
 * @param {Date|string|number} date - Date object, ISO string, or Unix timestamp
 * @returns {string} Formatted date and time
 */
function formatDateTime(date) {
    if (!date) return 'N/A';
    
    let dateObj;
    
    if (date instanceof Date) {
        dateObj = date;
    } else if (typeof date === 'string') {
        dateObj = new Date(date);
    } else if (typeof date === 'number') {
        if (date < 10000000000) {
            dateObj = new Date(date * 1000);
        } else {
            dateObj = new Date(date);
        }
    } else {
        return 'N/A';
    }
    
    if (isNaN(dateObj.getTime())) {
        return 'N/A';
    }
    
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}
