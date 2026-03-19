export function encodeCursor(sourceTimestamp: string, id: string): string {
  return btoa(JSON.stringify([sourceTimestamp, id]));
}

export function decodeCursor(cursor: string): [string, string] | null {
  try {
    const data = JSON.parse(atob(cursor));
    if (Array.isArray(data) && data.length >= 2) {
      return [data[0], data[1]];
    }
    return null;
  } catch {
    return null;
  }
}
