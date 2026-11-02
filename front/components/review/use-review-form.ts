'use client'

import { useEffect, useReducer, useRef, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import {
  initialReviewFormState,
  reviewFormReducer,
  submitReview,
  type ChecklistValues,
  type FormErrors,
  type ReviewActionResult,
  type ReviewFormState,
} from '@/lib/domain/case-review-form'

type Options<V> = {
  empty: V
  validate: (values: V, state: ReviewFormState<V>) => FormErrors
  send: (values: V, state: ReviewFormState<V>) => Promise<ReviewActionResult>
}

// Solo conecta React con las reglas de `case-review-form`, que no dependen del navegador.
export function useReviewForm<V extends { decision: string; checklist: ChecklistValues }>({ empty, validate, send }: Options<V>) {
  const router = useRouter()
  const [state, dispatch] = useReducer(reviewFormReducer<V>, empty, initialReviewFormState<V>)
  const [pending, startTransition] = useTransition()
  const feedbackRef = useRef<HTMLDivElement>(null)

  // Quien navega con teclado o lector de pantalla llega al resultado sin buscarlo.
  useEffect(() => {
    if (state.focusTick > 0) feedbackRef.current?.focus()
  }, [state.focusTick])

  return {
    state,
    pending,
    feedbackRef,
    change: (patch: Partial<V>) => dispatch({ type: 'change', patch }),
    reload: () => {
      dispatch({ type: 'reloaded' })
      router.refresh()
    },
    submit: (event: FormEvent) => {
      event.preventDefault()
      submitReview<V>({
        values: state.values,
        validate: values => validate(values, state),
        send: values => send(values, state),
        dispatch,
        startTransition,
        refresh: () => router.refresh(),
      })
    },
  }
}
