/**
 * Join a browse location with a path relative to it.
 *
 * @param location Current browse location, ``""`` for the workspace root.
 * @param relative Path relative to that location, e.g. ``"src/app.ts"``.
 * @returns The combined location.
 */
export function joinBrowseLocation(location: string, relative: string): string {
  if (!relative) return location;
  if (!location) return relative;
  return location === "/" ? `/${relative}` : `${location}/${relative}`;
}

/**
 * Express a browsed absolute path as a location relative to the workspace,
 * falling back to the absolute form when it lies outside.
 *
 * The two forms are not interchangeable on the wire: the server authorizes an
 * absolute location at owner level (it can name any path on the host) but a
 * relative one at the viewer's normal read level. Sending a subfolder of the
 * workspace in absolute form would therefore refuse every collaborator, even
 * though the folder sits inside the workspace they can already list.
 *
 * @param browsed Absolute path being browsed, or ``null`` for the root.
 * @param workspaceRoot Absolute workspace root, or ``null`` when unknown.
 * @returns ``""`` for the root, a relative path when inside, else absolute.
 */
export function relativizeToWorkspace(
  browsed: string | null,
  workspaceRoot: string | null,
): string {
  if (!browsed) return "";
  if (!workspaceRoot) return browsed;
  const root = workspaceRoot.replace(/\/$/, "");
  if (browsed === root) return "";
  // The separator guard keeps a sibling like "/work/project-old" from being
  // read as a child of "/work/project".
  return browsed.startsWith(`${root}/`) ? browsed.slice(root.length + 1) : browsed;
}
