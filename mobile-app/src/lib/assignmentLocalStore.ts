import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const INDEX_KEY = 'assignmentResponses:v1';

export type LocalAssignmentResponse = {
  occurrenceId: number;
  responseType: string;
  textBody?: string | null;
  localUri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  remoteUrl?: string | null;
  savedAt: string;
};

type IndexMap = Record<string, LocalAssignmentResponse>;

function dir() {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${base}assignment-responses/`;
}

async function ensureDir() {
  const path = dir();
  if (!path) return path;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
  return path;
}

async function readIndex(): Promise<IndexMap> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeIndex(map: IndexMap) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(map));
}

export async function getLocalAssignmentResponse(
  occurrenceId: number,
): Promise<LocalAssignmentResponse | null> {
  const map = await readIndex();
  const row = map[String(occurrenceId)];
  if (!row) return null;
  if (row.localUri) {
    const info = await FileSystem.getInfoAsync(row.localUri);
    if (!info.exists) {
      return { ...row, localUri: null };
    }
  }
  return row;
}

export async function listLocalAssignmentResponses(): Promise<LocalAssignmentResponse[]> {
  const map = await readIndex();
  return Object.values(map).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

export async function saveLocalAssignmentResponse(input: {
  occurrenceId: number;
  responseType: string;
  textBody?: string | null;
  sourceUri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  remoteUrl?: string | null;
}): Promise<LocalAssignmentResponse> {
  const root = await ensureDir();
  let localUri: string | null = null;
  if (input.sourceUri && root) {
    const ext =
      (input.fileName || '').split('.').pop() ||
      (input.mimeType || '').split('/').pop() ||
      'bin';
    const dest = `${root}occ-${input.occurrenceId}-${Date.now()}.${ext}`;
    try {
      await FileSystem.copyAsync({ from: input.sourceUri, to: dest });
      localUri = dest;
    } catch {
      // Fall back to original URI if copy fails (may be temporary).
      localUri = input.sourceUri;
    }
  }

  const row: LocalAssignmentResponse = {
    occurrenceId: input.occurrenceId,
    responseType: input.responseType,
    textBody: input.textBody ?? null,
    localUri,
    mimeType: input.mimeType ?? null,
    fileName: input.fileName ?? null,
    remoteUrl: input.remoteUrl ?? null,
    savedAt: new Date().toISOString(),
  };

  const map = await readIndex();
  const prev = map[String(input.occurrenceId)];
  if (prev?.localUri && prev.localUri !== localUri && prev.localUri.startsWith(root)) {
    try {
      await FileSystem.deleteAsync(prev.localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
  map[String(input.occurrenceId)] = row;
  await writeIndex(map);
  return row;
}

export async function clearLocalAssignmentResponse(occurrenceId: number) {
  const map = await readIndex();
  const row = map[String(occurrenceId)];
  if (row?.localUri) {
    try {
      await FileSystem.deleteAsync(row.localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
  delete map[String(occurrenceId)];
  await writeIndex(map);
}

export async function clearAllLocalAssignmentResponses() {
  const map = await readIndex();
  for (const row of Object.values(map)) {
    if (row.localUri) {
      try {
        await FileSystem.deleteAsync(row.localUri, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }
  await AsyncStorage.removeItem(INDEX_KEY);
  const root = dir();
  if (root) {
    try {
      await FileSystem.deleteAsync(root, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
}
