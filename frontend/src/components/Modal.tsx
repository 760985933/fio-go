import { useState, useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  content: string
  type: 'info' | 'confirm' | 'prompt' | 'results'
  wide?: boolean
  onClose: () => void
  onConfirm: (value: any) => void
}

export function Modal({ open, title, content, type, wide, onClose, onConfirm }: Props) {
  const [inputValue, setInputValue] = useState(content)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setInputValue(content)
    if (type === 'prompt' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [content, type])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {type === 'prompt' ? (
            <input
              ref={inputRef}
              className="modal-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirm(inputValue)
              }}
            />
          ) : type === 'results' ? (
            <div className="log-viewer">{content}</div>
          ) : (
            <pre className="modal-content-text">{content}</pre>
          )}
        </div>
        <div className="modal-footer">
          {type === 'confirm' && (
            <>
              <button className="btn btn-outline" onClick={onClose}>取消</button>
              <button className="btn btn-danger" onClick={() => onConfirm(true)}>确认</button>
            </>
          )}
          {type === 'prompt' && (
            <>
              <button className="btn btn-outline" onClick={onClose}>取消</button>
              <button className="btn btn-primary" onClick={() => onConfirm(inputValue)}>确定</button>
            </>
          )}
          {(type === 'info' || type === 'results') && (
            <button className="btn btn-primary" onClick={onClose}>关闭</button>
          )}
        </div>
      </div>
    </div>
  )
}
