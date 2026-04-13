import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { Loader2, Eye, EyeOff, Lock, Mail, ArrowRight, Ship } from 'lucide-react';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

function loadTurnstileScript() {
  if (typeof window === 'undefined') return;
  if (document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)) return;
  const s = document.createElement('script');
  s.src = TURNSTILE_SCRIPT_SRC;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileContainerRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load Turnstile script once captcha becomes required
  useEffect(() => {
    if (captchaRequired) loadTurnstileScript();
  }, [captchaRequired]);

  // Render Turnstile widget when required and script is ready
  useEffect(() => {
    if (!captchaRequired || !TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    const tryRender = () => {
      if (cancelled) return;
      if (window.turnstile && turnstileContainerRef.current && turnstileWidgetIdRef.current == null) {
        turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => setCaptchaToken(token),
          'error-callback': () => setCaptchaToken(''),
          'expired-callback': () => setCaptchaToken(''),
        });
      } else if (!window.turnstile) {
        setTimeout(tryRender, 200);
      }
    };
    tryRender();

    return () => {
      cancelled = true;
      if (window.turnstile && turnstileWidgetIdRef.current != null) {
        try { window.turnstile.remove(turnstileWidgetIdRef.current); } catch { /* noop */ }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [captchaRequired]);

  if (isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const resetCaptcha = () => {
    setCaptchaToken('');
    if (window.turnstile && turnstileWidgetIdRef.current != null) {
      try { window.turnstile.reset(turnstileWidgetIdRef.current); } catch { /* noop */ }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (captchaRequired && !captchaToken) {
      setError('Please complete the captcha challenge.');
      return;
    }

    setLoading(true);
    const result = await login(email, password, captchaToken);

    if (result.success) {
      navigate('/', { replace: true });
    } else {
      setError(result.error || 'Invalid credentials. Please try again.');
      if (result.captchaRequired) setCaptchaRequired(true);
      resetCaptcha();
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#070b14' }}>
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-[55%] relative overflow-hidden flex-col justify-between p-12"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        }}
      >
        {/* Decorative elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }} />
          <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)' }} />
          {/* Grid pattern */}
          <div className="absolute inset-0" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }} />
        </div>

        {/* Top — logo */}
        <div className={`relative transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-3">
            <img src="/logo.jpg" alt="AgriRice" className="w-11 h-11 rounded-xl object-contain" />
            <div>
              <span className="text-lg font-bold text-white tracking-wide">AGRI COMMODITIES</span>
              <p className="text-[10px] italic" style={{ color: '#d4a853' }}>Serving Natural Nutrition</p>
            </div>
          </div>
        </div>

        {/* Center — hero text */}
        <div className={`relative space-y-6 transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <h1 className="text-4xl font-bold text-white leading-tight">
            Rice Export &<br />
            Milling Operations<br />
            <span className="text-blue-400">Unified.</span>
          </h1>
          <p className="text-slate-400 text-base max-w-md leading-relaxed">
            Manage your entire rice supply chain — from paddy procurement and milling
            to export documentation and shipment tracking — all in one platform.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 pt-2">
            {['Export Orders', 'Mill Operations', 'Quality Control', 'Finance', 'Inventory', 'Documents'].map((f, i) => (
              <span
                key={f}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-500 ${
                  mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
                style={{
                  transitionDelay: `${400 + i * 80}ms`,
                  backgroundColor: 'rgba(59,130,246,0.08)',
                  borderColor: 'rgba(59,130,246,0.15)',
                  color: '#93c5fd',
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom — company info */}
        <div className={`relative transition-all duration-700 delay-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-3">
            <img
              src="/logo.jpg"
              alt="Logo"
              className="w-10 h-10 rounded-lg object-cover border border-white/10"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <div>
              <p className="text-sm font-semibold text-white">AGRI COMMODITIES</p>
              <p className="text-xs" style={{ color: '#d4a853' }}>Serving Natural Nutrition</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className={`w-full max-w-[400px] transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>

          {/* Mobile logo — shown on small screens */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex justify-center mb-3">
              <img src="/logo.jpg" alt="AgriRice" className="w-14 h-14 rounded-2xl object-contain" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide">
              AGRI COMMODITIES
            </h1>
            <p className="text-xs italic mt-1" style={{ color: '#d4a853' }}>Serving Natural Nutrition</p>
          </div>

          {/* Welcome text */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white">Welcome back</h2>
            <p className="text-sm text-slate-500 mt-1">Sign in to continue to your dashboard</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-red-400 text-xs font-bold">!</span>
              </div>
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Email
              </label>
              <div className="relative">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@riceflow.com"
                  required
                  autoComplete="email"
                  className="w-full pl-11 pr-4 py-3 text-sm text-white rounded-xl border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all placeholder:text-slate-600"
                  style={{ backgroundColor: 'rgba(15,23,42,0.8)' }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="w-full pl-11 pr-12 py-3 text-sm text-white rounded-xl border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all placeholder:text-slate-600"
                  style={{ backgroundColor: 'rgba(15,23,42,0.8)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="w-3.5 h-3.5 rounded border-slate-600 text-blue-500 focus:ring-blue-500/30 bg-slate-800" />
                <span className="text-slate-500">Remember me</span>
              </label>
              <button type="button" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
                Forgot password?
              </button>
            </div>

            {/* Captcha (shown after repeated failures) */}
            {captchaRequired && (
              <div className="flex flex-col items-center gap-2 py-1">
                <div ref={turnstileContainerRef} />
                {!TURNSTILE_SITE_KEY && (
                  <p className="text-[11px] text-amber-400">
                    Captcha key not configured (VITE_TURNSTILE_SITE_KEY).
                  </p>
                )}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || (captchaRequired && !captchaToken)}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              style={{
                background: loading ? '#2563eb' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                boxShadow: '0 4px 15px rgba(37,99,235,0.3)',
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="mt-8 pt-6 border-t border-slate-800/50">
            <p className="text-center text-xs text-slate-600">
              Secured with end-to-end encryption
            </p>
          </div>

          {/* Footer */}
          <p className="text-center text-[11px] text-slate-700 mt-6">
            &copy; {new Date().getFullYear()} Agri Commodities &middot; Karachi, Pakistan
          </p>
        </div>
      </div>
    </div>
  );
}
