/**
 * Global query error handler.
 * Shows toast notifications for mutation errors and logs query failures.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../context/AppContext';

export default function QueryErrorHandler() {
  const { addToast } = useApp();
  const qc = useQueryClient();

  useEffect(() => {
    // Subscribe to global mutation errors
    const unsubscribe = qc.getMutationCache().subscribe((event) => {
      if (event?.type === 'updated' && event?.mutation?.state?.status === 'error') {
        const error = event.mutation.state.error;
        const message = error?.data?.message || error?.message || 'Operation failed';

        // Don't show duplicate toast if the mutation handler already showed one
        if (!error._toastShown) {
          addToast(message, 'error');
          error._toastShown = true;
        }
      }
    });

    return () => unsubscribe();
  }, [qc, addToast]);

  return null;
}
