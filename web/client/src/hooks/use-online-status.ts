import { useState, useEffect, useCallback } from 'react';
import {
  syncPendingUpdates,
  getPendingCount,
  isDataPending,
  type SyncResult,
} from '@/lib/offline-storage';
import { trackingApi } from '@/lib/api';

export interface OnlineStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;
  sync: () => Promise<SyncResult>;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  // Sync pending updates
  const sync = useCallback(async (): Promise<SyncResult> => {
    if (isSyncing || !isOnline) {
      return { success: 0, failed: 0, errors: ['Sync already in progress or offline'] };
    }

    setIsSyncing(true);
    try {
      const result = await syncPendingUpdates({
        updateSet: async (token, setId, data) => {
          return trackingApi.updateSet(token, setId, data as Parameters<typeof trackingApi.updateSet>[2]);
        },
        createSets: async (token, sets) => {
          return trackingApi.createSets(token, sets as Parameters<typeof trackingApi.createSets>[1]);
        },
        updateSession: async (token, data) => {
          return trackingApi.updateSession(token, data as Parameters<typeof trackingApi.updateSession>[1]);
        },
      });

      setLastSyncResult(result);
      await updatePendingCount();
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, isOnline, updatePendingCount]);

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming back online
      sync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial pending count
    updatePendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [sync, updatePendingCount]);

  // Periodically update pending count
  useEffect(() => {
    const interval = setInterval(updatePendingCount, 5000);
    return () => clearInterval(interval);
  }, [updatePendingCount]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncResult,
    sync,
  };
}

// Simpler hook for just online/offline status
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
