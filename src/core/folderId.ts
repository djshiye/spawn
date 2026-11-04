// Validation of pinned-folder ids. Pure, no imports (used by the migration mapping and settings).
//
// Public API:
//   isValidFolderId(id): boolean   ids become a dconf path element (folders/<id>/): [A-Za-z0-9_-], 1..64 chars

const FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidFolderId(id: string): boolean {
    return FOLDER_ID.test(id);
}
