import { useState, useCallback } from 'react'

interface ModalState {
  open: boolean
  title: string
  content: string
  type: 'info' | 'confirm' | 'prompt' | 'results'
  resolve?: (value: any) => void
}

export function useModal() {
  const [modal, setModal] = useState<ModalState>({
    open: false,
    title: '',
    content: '',
    type: 'info',
  })

  const close = useCallback(() => {
    if (modal.resolve) modal.resolve(null)
    setModal(prev => ({ ...prev, open: false }))
  }, [modal])

  const confirm = useCallback((value: any) => {
    if (modal.resolve) modal.resolve(value)
    setModal(prev => ({ ...prev, open: false }))
  }, [modal])

  const showInfo = useCallback((title: string, content: string) => {
    return new Promise<void>((resolve) => {
      setModal({ open: true, title, content, type: 'info', resolve: () => resolve() })
    })
  }, [])

  const showConfirm = useCallback((title: string, content: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setModal({ open: true, title, content, type: 'confirm', resolve })
    })
  }, [])

  const showPrompt = useCallback((title: string, defaultValue?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setModal({ open: true, title, content: defaultValue || '', type: 'prompt', resolve })
    })
  }, [])

  const showResults = useCallback((title: string, content: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      setModal({ open: true, title, content, type: 'results', resolve: () => resolve() })
    })
  }, [])

  return { modal, close, confirm, showInfo, showConfirm, showPrompt, showResults }
}
