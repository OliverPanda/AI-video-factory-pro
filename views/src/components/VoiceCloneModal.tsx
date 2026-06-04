
import { useState, useRef } from 'react';
import { X, Upload, Mic, Play, Save, Wand2, Loader2, Volume2 } from 'lucide-react';

interface VoiceCloneModalProps {
  onClose: () => void;
  onSave: (voiceData: any) => void;
  projectId: string;
}

export default function VoiceCloneModal({ onClose, onSave, projectId }: VoiceCloneModalProps) {
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [loading, setLoading] = useState(false);
  const [_file, setFile] = useState<File | null>(null);
  const [refAudioUrl, setRefAudioUrl] = useState<string | null>(null);
  const [refAudioPath, setRefAudioPath] = useState<string | null>(null);
  
  const [previewText, setPreviewText] = useState('你好，我是这个角色的新声音。');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [voiceName, setVoiceName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setRefAudioUrl(URL.createObjectURL(selectedFile));
      
      // Upload immediately to get path
      setLoading(true);
      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const res = await fetch('/api/voices/references', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        setRefAudioPath(data.path);
        setStep('preview');
      } catch (error) {
        alert('文件上传失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePreview = async () => {
    if (!refAudioPath) return;
    setPreviewLoading(true);
    try {
        const res = await fetch('/api/voices/preview', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                text: previewText,
                reference_audio_path: refAudioPath,
                speed: 1.0,
                pitch: 1.0
            })
        });
        const data = await res.json();
        setPreviewUrl(data.audio_url);
    } catch (error) {
        alert('生成试听失败');
    } finally {
        setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
     if (!voiceName || !refAudioPath) return;
     setLoading(true);
     try {
         const res = await fetch('/api/voices/clone', {
             method: 'POST',
             headers: {'Content-Type': 'application/json'},
             body: JSON.stringify({
                 name: voiceName,
                 project_id: projectId,
                 reference_audio_path: refAudioPath
             })
         });
         const newVoice = await res.json();
         onSave(newVoice);
         onClose();
     } catch (error) {
         alert('保存声音失败');
     } finally {
         setLoading(false);
     }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-white/90 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Mic className="text-cyan-500" />
              声音克隆工作室
            </h2>
            <p className="text-sm text-slate-500 mt-1">上传一段 10-30秒 的干声，AI 将为你克隆该音色。</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8">
            {step === 'upload' ? (
                <div 
                    className="border-2 border-dashed border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-slate-50 transition-all text-center group"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="audio/*"
                        onChange={handleFileChange}
                    />
                    <div className="w-16 h-16 rounded-full bg-cyan-100 text-cyan-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        {loading ? <Loader2 className="animate-spin" /> : <Upload size={32} />}
                    </div>
                    <p className="text-lg font-medium text-slate-900 mb-2">点击上传音频文件</p>
                    <p className="text-sm text-slate-400">支持 MP3, WAV, M4A (Max 10MB)</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Reference Player */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-cyan-100 text-cyan-500 flex items-center justify-center">
                            <Volume2 size={20} />
                        </div>
                        <div className="flex-1">
                            <p className="text-xs text-slate-500 mb-1">参考源音频</p>
                            <div className="h-1 bg-slate-200 rounded-full overflow-hidden w-full">
                                <div className="h-full w-2/3 bg-cyan-500 rounded-full"></div>
                            </div>
                        </div>
                        <audio src={refAudioUrl || ''} controls className="h-8 w-32" />
                    </div>

                    {/* Preview Area */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-slate-600">测试文本</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={previewText}
                                onChange={(e) => setPreviewText(e.target.value)}
                                className="flex-1 bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-cyan-500/50"
                            />
                            <button
                                onClick={handlePreview}
                                disabled={previewLoading}
                                className="px-4 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-xl border border-slate-200 transition-colors flex items-center gap-2"
                            >
                                {previewLoading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                                试听
                            </button>
                        </div>
                    </div>

                    {/* Generated Player */}
                    {previewUrl && (
                         <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center">
                                <Play size={20} className="ml-0.5" />
                            </div>
                            <div className="flex-1">
                                <p className="text-xs text-emerald-500/80 mb-1">AI 生成结果</p>
                                <p className="text-sm text-emerald-700">生成完毕，点击播放</p>
                            </div>
                            <audio src={previewUrl} controls className="h-8 w-32" />
                        </div>
                    )}
                    
                    <div className="h-px bg-slate-200 my-4" />

                    {/* Save Area */}
                    <div className="space-y-3">
                         <label className="text-sm font-medium text-slate-600">为这个声音命名</label>
                         <input
                                type="text"
                                placeholder="例如: 磁性男低音"
                                value={voiceName}
                                onChange={(e) => setVoiceName(e.target.value)}
                                className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-cyan-500/50"
                        />
                    </div>
                </div>
            )}
        </div>

        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
            <button
                onClick={onClose}
                className="px-5 py-2.5 text-slate-500 hover:text-slate-900 transition-colors"
            >
                取消
            </button>
            {step === 'preview' && (
                <button 
                    onClick={handleSave}
                    disabled={loading || !voiceName}
                    className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white font-medium rounded-xl shadow-lg shadow-cyan-500/25 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    确认保存
                </button>
            )}
        </div>
      </div>
    </div>
  );
}
