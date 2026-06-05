import { Suspense, StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'

const Layout = lazy(() => import('./components/Layout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const DramaDetail = lazy(() => import('./pages/DramaDetail'))
const CharacterManager = lazy(() => import('./pages/CharacterManager'))
const SceneManager = lazy(() => import('./pages/SceneManager'))
const VoiceManager = lazy(() => import('./pages/VoiceManager'))
const Editor = lazy(() => import('./pages/Editor').then((mod) => ({ default: mod.Editor })))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Dashboard />} />

            {/* 漫剧管理路由 */}
            <Route path="/drama/:id" element={<DramaDetail />} />
            <Route path="/drama/:id/characters" element={<CharacterManager />} />
            <Route path="/drama/:id/scenes" element={<SceneManager />} />
            <Route path="/drama/:id/voices" element={<VoiceManager />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
