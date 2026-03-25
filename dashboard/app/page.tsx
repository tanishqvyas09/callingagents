import CallDispatcher from '@/components/CallDispatcher';
import BulkDialer from '@/components/BulkDialer';
import VoiceRoom from '@/components/VoiceRoom';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden selection:bg-purple-500/30">

      {/* Ambient Background Lights */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10vh] left-[20vw] w-[50vh] h-[50vh] bg-blue-600/20 rounded-full blur-[128px] animate-pulse"></div>
        <div className="absolute bottom-[-10vh] right-[20vw] w-[60vh] h-[60vh] bg-purple-600/15 rounded-full blur-[128px] animate-pulse delay-1000"></div>
        <div className="absolute top-[40vh] right-[5vw] w-[40vh] h-[40vh] bg-cyan-600/10 rounded-full blur-[128px] animate-pulse delay-500"></div>
      </div>

      {/* Grid Pattern Overlay */}
      <div className="fixed inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-20 pointer-events-none"></div>

      <div className="z-10 flex flex-col items-center gap-12 w-full max-w-7xl">
        <header className="text-center space-y-4 animate-in fade-in slide-in-from-top-8 duration-700">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-purple-300 mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            System Online
          </div>

          <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight">
            <span className="text-white">Rapid X</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"> AI</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto font-light leading-relaxed">
            Next-Gen Voice Agent Orchestration.
          </p>
        </header>

        {/* ── Section 1: VoIP Browser Call (NEW) ── */}
        <section className="w-full flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
          <div className="flex items-center gap-3">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-cyan-500/50" />
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-widest">
              🎙 Live VoIP — Talk directly from your browser
            </span>
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-cyan-500/50" />
          </div>
          <VoiceRoom />
        </section>

        {/* ── Section 2: PSTN / SIP Phone Calls ── */}
        <section className="w-full flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200">
          <div className="flex items-center gap-3">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-purple-500/50" />
            <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest">
              📞 Outbound Phone Calls — Dial real numbers via SIP trunk
            </span>
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-purple-500/50" />
          </div>
          <div className="flex flex-col md:flex-row gap-8 w-full justify-center items-start">
            <CallDispatcher />
            <BulkDialer />
          </div>
        </section>

        {/* ── Section 3: NGO Dashboard link ── */}
        <section className="w-full flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
          <div className="flex items-center gap-3">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-rose-500/50" />
            <span className="text-xs font-semibold text-rose-400 uppercase tracking-widest">
              🌸 NGO — Making the Difference · Team Lajja Survey
            </span>
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-rose-500/50" />
          </div>
          <a
            href="/ngo"
            className="px-8 py-4 rounded-2xl bg-gradient-to-r from-rose-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:scale-105 transition-transform"
          >
            🌸 Open NGO Menstrual Hygiene Dashboard →
          </a>
          <p className="text-xs text-gray-500 text-center max-w-md">
            Multilingual outbound survey (Hindi · English · Telugu) with real-time millisecond analytics.
            Powered by Sarvam saaras:v3 STT + bulbul:v3 TTS + Groq LLM.
          </p>
        </section>

        <footer className="text-sm text-gray-500 animate-in fade-in duration-1000 delay-500 text-center space-y-2">
          <p>Powered by <span className="text-white font-semibold">Rapid X AI</span></p>
          <div className="flex gap-4 justify-center text-xs">
            <a href="https://instagram.com/ai.w.raj" target="_blank" className="hover:text-pink-400 transition-colors">Instagram: @ai.w.raj</a>
            <span className="text-gray-700">|</span>
            <a href="https://x.com/topR9595" target="_blank" className="hover:text-blue-400 transition-colors">X: @topR9595</a>
            <span className="text-gray-700">|</span>
            <a href="https://youtube.com/@ShreyasRaj" target="_blank" className="hover:text-red-400 transition-colors">YouTube: Shreyas Raj</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
