-- Création des tables PostgreSQL

-- Table des utilisateurs
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'formateur', 'stagiaire')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des canaux
CREATE TABLE channels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des abonnements
CREATE TABLE channel_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, channel_id)
);

-- Table des sessions de streaming
CREATE TABLE streaming_sessions (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    viewer_count INTEGER DEFAULT 0,
    total_frames INTEGER DEFAULT 0,
    avg_frame_size INTEGER DEFAULT 0
);

-- Table des sessions utilisateurs (tokens)
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- Index pour optimiser les performances
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_channels_created_by ON channels(created_by);
CREATE INDEX idx_subscriptions_user ON channel_subscriptions(user_id);
CREATE INDEX idx_subscriptions_channel ON channel_subscriptions(channel_id);
CREATE INDEX idx_sessions_channel ON streaming_sessions(channel_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

-- Insertion d'un admin par défaut
INSERT INTO users (nom, prenom, email, password, role) 
VALUES ('Admin', 'System', 'njatomiarintsoawilliam@gmail.com', '$2a$10$N9qo8uLOickgx2ZMRZoMye.J.6WJ3z7H.6J.6WJ3z7H.6J.6WJ3z7H', 'admin')
ON CONFLICT (email) DO NOTHING;