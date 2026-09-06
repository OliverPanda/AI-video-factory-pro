import { Suspense, StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route, useParams, useSearchParams } from 'react-router-dom'
import { ToastProvider } from './components/ToastContext'
import './index.css'

const Layout = lazy(() => import('./components/Layout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const DramaDetail = lazy(() => import('./pages/DramaDetail'))
const CharacterManager = lazy(() => import('./pages/CharacterManager'))
const SceneManager = lazy(() => import('./pages/SceneManager'))
const AssetLibrary = lazy(() => import('./pages/AssetLibrary'))
const Settings = lazy(() => import('./pages/Settings'))
const Editor = lazy(() => import('./pages/Editor').then((mod) => ({ default: mod.Editor })))
const PreviewReviewPage = lazy(() => import('./components/review/PreviewReviewPage'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
    </div>
  )
}

function VoicesRedirect() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const query = searchParams.toString()
  return <Navigate to={`/drama/${id}/characters${query ? `?${query}` : ''}`} replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/editor" element={<ToastProvider><Editor /></ToastProvider>} />
          <Route path="/review/:runId" element={<ToastProvider><PreviewReviewPage /></ToastProvider>} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/project/:id" element={<ProjectDetail />} />

            {/* 漫剧管理路由 */}
            <Route path="/drama/:id" element={<DramaDetail />} />
            <Route path="/drama/:id/characters" element={<CharacterManager />} />
            <Route path="/drama/:id/scenes" element={<SceneManager />} />
            <Route path="/drama/:id/voices" element={<VoicesRedirect />} />
            <Route path="/project/:id/assets" element={<AssetLibrary />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
