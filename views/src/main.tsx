import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import DramaDetail from './pages/DramaDetail'
import CharacterManager from './pages/CharacterManager'
import SceneManager from './pages/SceneManager'
import VoiceManager from './pages/VoiceManager'
import { Editor } from './pages/Editor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
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
    </BrowserRouter>
  </StrictMode>,
)

