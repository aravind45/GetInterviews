
/**
 * In-memory session store to maintain compatibility with legacy frontend behavior.
 * Ideally this should be replaced by Redis or Database storage.
 */

// In-memory storage matching index.ts structure
const sessions: Record<string, any> = {};

export default {
    get: (id: string) => sessions[id],
    set: (id: string, data: any) => {
        sessions[id] = data;
        return sessions[id];
    },
    update: (id: string, data: any) => {
        if (!sessions[id]) sessions[id] = {};
        sessions[id] = { ...sessions[id], ...data };
        return sessions[id];
    },
    delete: (id: string) => {
        delete sessions[id];
    },
    getAll: () => sessions
};
