const fs = require('fs');
const path = require('path');

class Dictionary {
    constructor() {
        this.words = new Set();
        this.isLoaded = false;
        this.loadDictionary();
    }

    loadDictionary() {
        try {
            const dataPath = path.join(__dirname, 'data', 'spanish_words.txt');
            if (fs.existsSync(dataPath)) {
                const content = fs.readFileSync(dataPath, 'utf-8');
                const lines = content.split(/\r?\n/);
                lines.forEach(line => {
                    const word = this.normalize(line.trim());
                    if (word.length > 2) {
                        this.words.add(word);
                    }
                });
                console.log(`Dictionary loaded with ${this.words.size} Spanish words.`);
                this.isLoaded = true;
            } else {
                console.error("Spanish word list file not found at:", dataPath);
            }
        } catch (err) {
            console.error("Error loading dictionary:", err);
        }
    }

    normalize(word) {
        return word.toUpperCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Remove accents
            .replace(/[^A-ZÑ]/g, ""); // Keep only A-Z and Ñ
    }

    isValid(word) {
        if (!this.isLoaded) {
            // Strict mode: if dictionary fails, block everything or allow nothing?
            // User wants "solo permita palabras de esa api".
            console.warn("Dictionary not loaded yet.");
            return false;
        }
        const normalized = this.normalize(word);
        return this.words.has(normalized);
    }
}

module.exports = new Dictionary();
