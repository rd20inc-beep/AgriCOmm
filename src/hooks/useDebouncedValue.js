import { useEffect, useState } from 'react';

/** `value`, settled for `ms` — so a server search fires once typing pauses. */
export default function useDebouncedValue(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
