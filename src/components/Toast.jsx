import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

const typeConfig = {
  success: {
    bg: 'bg-emerald-50 border-emerald-200',
    icon: CheckCircle,
    iconColor: 'text-emerald-500',
    text: 'text-emerald-800',
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    icon: XCircle,
    iconColor: 'text-red-500',
    text: 'text-red-800',
  },
  warning: {
    bg: 'bg-amber-50 border-amber-200',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    text: 'text-amber-800',
  },
  info: {
    bg: 'bg-blue-50 border-blue-200',
    icon: Info,
    iconColor: 'text-blue-500',
    text: 'text-blue-800',
  },
};

export default function Toast() {
  const { toasts, setToasts } = useApp();

  if (!toasts || toasts.length === 0) return null;

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2.5 sm:max-w-sm sm:w-full">
      {toasts.map((toast) => {
        const config = typeConfig[toast.type] || typeConfig.info;
        const Icon = config.icon;

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg animate-slide-in ${config.bg}`}
          >
            <Icon size={18} className={`flex-shrink-0 mt-0.5 ${config.iconColor}`} />
            <p className={`text-sm font-medium flex-1 leading-snug ${config.text}`}>
              {toast.message}
            </p>
            <button
              onClick={() => removeToast(toast.id)}
              className={`flex-shrink-0 p-0.5 rounded-md hover:bg-black/5 transition-colors ${config.text}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
