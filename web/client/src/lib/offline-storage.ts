import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { WorkoutSetData, TrackingWorkoutData } from './api';

// Define the database schema
interface WorkoutTrackerDB extends DBSchema {
  pendingUpdates: {
    key: number;
    value: PendingUpdate;
    indexes: { 'by-token': string };
  };
  workoutCache: {
    key: string; // token
    value: CachedWorkout;
  };
}

export interface PendingUpdate {
  id?: number;
  type: 'updateSet' | 'createSets' | 'updateSession';
  token: string;
  setId?: number;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface CachedWorkout {
  token: string;
  data: TrackingWorkoutData;
  timestamp: number;
  // Local modifications not yet synced
  localSets: Record<string, Partial<WorkoutSetData>>; // key: "exerciseIndex-setNumber"
}

const DB_NAME = 'workout-tracker-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<WorkoutTrackerDB>> | null = null;

// Initialize database
function getDB(): Promise<IDBPDatabase<WorkoutTrackerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WorkoutTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Store for pending API calls that need to sync
        const pendingStore = db.createObjectStore('pendingUpdates', {
          keyPath: 'id',
          autoIncrement: true,
        });
        pendingStore.createIndex('by-token', 'token');

        // Store for cached workout data
        db.createObjectStore('workoutCache', { keyPath: 'token' });
      },
    });
  }
  return dbPromise;
}

// ============================================
// Workout Cache Operations
// ============================================

export async function cacheWorkout(token: string, data: TrackingWorkoutData): Promise<void> {
  const db = await getDB();
  const existing = await db.get('workoutCache', token);

  await db.put('workoutCache', {
    token,
    data,
    timestamp: Date.now(),
    localSets: existing?.localSets || {},
  });
}

export async function getCachedWorkout(token: string): Promise<CachedWorkout | undefined> {
  const db = await getDB();
  return db.get('workoutCache', token);
}

export async function updateLocalSet(
  token: string,
  exerciseIndex: number,
  setNumber: number,
  updates: Partial<WorkoutSetData>
): Promise<void> {
  const db = await getDB();
  const cached = await db.get('workoutCache', token);

  if (cached) {
    const key = `${exerciseIndex}-${setNumber}`;
    cached.localSets[key] = {
      ...cached.localSets[key],
      ...updates,
    };
    cached.timestamp = Date.now();
    await db.put('workoutCache', cached);
  }
}

export async function clearLocalSets(token: string): Promise<void> {
  const db = await getDB();
  const cached = await db.get('workoutCache', token);

  if (cached) {
    cached.localSets = {};
    await db.put('workoutCache', cached);
  }
}

// ============================================
// Pending Updates Operations
// ============================================

export async function queueSetUpdate(
  token: string,
  setId: number,
  data: Partial<WorkoutSetData>
): Promise<void> {
  const db = await getDB();
  await db.add('pendingUpdates', {
    type: 'updateSet',
    token,
    setId,
    data,
    timestamp: Date.now(),
  });
}

export async function queueSetCreate(
  token: string,
  sets: Array<{
    exerciseName: string;
    exerciseIndex: number;
    setNumber: number;
    weight?: number | null;
    reps?: number | null;
    completed?: number;
  }>
): Promise<void> {
  const db = await getDB();
  await db.add('pendingUpdates', {
    type: 'createSets',
    token,
    data: { sets },
    timestamp: Date.now(),
  });
}

export async function queueSessionUpdate(
  token: string,
  data: Record<string, unknown>
): Promise<void> {
  const db = await getDB();
  await db.add('pendingUpdates', {
    type: 'updateSession',
    token,
    data,
    timestamp: Date.now(),
  });
}

export async function getPendingUpdates(token?: string): Promise<PendingUpdate[]> {
  const db = await getDB();

  if (token) {
    return db.getAllFromIndex('pendingUpdates', 'by-token', token);
  }
  return db.getAll('pendingUpdates');
}

export async function removePendingUpdate(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('pendingUpdates', id);
}

export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  return db.count('pendingUpdates');
}

// ============================================
// Sync Operations
// ============================================

export interface SyncResult {
  success: number;
  failed: number;
  errors: string[];
}

export async function syncPendingUpdates(
  apiCalls: {
    updateSet: (token: string, setId: number, data: Record<string, unknown>) => Promise<unknown>;
    createSets: (token: string, sets: unknown[]) => Promise<unknown>;
    updateSession: (token: string, data: Record<string, unknown>) => Promise<unknown>;
  }
): Promise<SyncResult> {
  const db = await getDB();
  const pending = await db.getAll('pendingUpdates');

  const result: SyncResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  // Sort by timestamp to maintain order
  pending.sort((a, b) => a.timestamp - b.timestamp);

  for (const update of pending) {
    try {
      switch (update.type) {
        case 'updateSet':
          if (update.setId !== undefined) {
            await apiCalls.updateSet(update.token, update.setId, update.data);
          }
          break;
        case 'createSets':
          await apiCalls.createSets(update.token, (update.data as { sets: unknown[] }).sets);
          break;
        case 'updateSession':
          await apiCalls.updateSession(update.token, update.data);
          break;
      }

      // Remove successful update
      if (update.id !== undefined) {
        await db.delete('pendingUpdates', update.id);
      }
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push(
        `Failed to sync ${update.type}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return result;
}

// ============================================
// Utility Functions
// ============================================

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear('pendingUpdates');
  await db.clear('workoutCache');
}

export async function isDataPending(): Promise<boolean> {
  const count = await getPendingCount();
  return count > 0;
}

// Merge cached data with local modifications
export function mergeLocalModifications(
  workout: TrackingWorkoutData,
  localSets: Record<string, Partial<WorkoutSetData>>
): TrackingWorkoutData {
  if (Object.keys(localSets).length === 0) {
    return workout;
  }

  // Deep clone to avoid mutation
  const merged = JSON.parse(JSON.stringify(workout)) as TrackingWorkoutData;

  // Apply local modifications to sets
  merged.sets = merged.sets.map((set) => {
    const key = `${set.exerciseIndex}-${set.setNumber}`;
    const localMods = localSets[key];

    if (localMods) {
      return { ...set, ...localMods };
    }
    return set;
  });

  return merged;
}
