import { Construction } from 'lucide-react';

interface ComingSoonProps {
  title: string;
}

export default function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div className="flex items-center justify-center h-[70vh]">
      <div className="text-center">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-cyan-100 to-teal-100 flex items-center justify-center mx-auto mb-6">
          <Construction className="text-cyan-500" size={48} />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 font-heading mb-3">{title}</h1>
        <p className="text-slate-500 text-lg mb-6">功能开发中，敬请期待...</p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 border border-slate-200 rounded-full text-sm text-slate-500">
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
          Coming Soon
        </div>
      </div>
    </div>
  );
}
