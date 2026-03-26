import { AlertCircle } from 'lucide-react';

export default function FieldError({ error }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-1 mt-1 text-xs text-red-600">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      <span>{error}</span>
    </div>
  );
}
