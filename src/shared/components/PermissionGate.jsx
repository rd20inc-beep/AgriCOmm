import { useAuth } from '../../context/AuthContext';

export default function PermissionGate({ module, action, children, fallback = null }) {
  const { hasPermission } = useAuth();

  if (!hasPermission(module, action)) return fallback;
  return children;
}
