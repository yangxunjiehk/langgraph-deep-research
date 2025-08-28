import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import { X } from "lucide-react";

interface ReportViewerProps {
  content: string;
  onClose: () => void;
}

export function ReportViewer({ content, onClose }: ReportViewerProps) {
  return (
    <div className="h-full flex flex-col border-l border-neutral-700">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-100">Research Report</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-neutral-700 text-neutral-400 hover:text-neutral-100"
          title="Close Report"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      
      {/* Report Content */}
      <ScrollArea className="flex-1 p-4">
        <div className="prose prose-invert prose-neutral max-w-none">
          <ReactMarkdown
            className="text-neutral-200 leading-relaxed"
            components={{
              // 自定义渲染组件
              h1: ({ children }) => (
                <h1 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-neutral-600">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-xl font-semibold text-white mt-6 mb-3">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg font-medium text-white mt-4 mb-2">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="text-neutral-200 mb-3 leading-relaxed">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="text-neutral-200 mb-3 pl-6 space-y-1">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="text-neutral-200 mb-3 pl-6 space-y-1">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="text-neutral-200">
                  {children}
                </li>
              ),
              strong: ({ children }) => (
                <strong className="text-white font-semibold">
                  {children}
                </strong>
              ),
              code: ({ children }) => (
                <code className="bg-neutral-800 text-neutral-200 px-1 py-0.5 rounded text-sm">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="bg-neutral-800 text-neutral-200 p-4 rounded-md overflow-x-auto mb-3">
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-neutral-600 pl-4 italic text-neutral-300 mb-3">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => (
                <a 
                  href={href} 
                  className="text-blue-400 hover:text-blue-300 underline"
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </ScrollArea>
    </div>
  );
}