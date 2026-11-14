import { lazy } from 'react'

export const SettingsDialog = lazy(() => import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })))
export const AIResultDialogs = lazy(() => import('./AIResultDialogs').then((module) => ({ default: module.AIResultDialogs })))
export const ScheduledJobsDialog = lazy(() => import('./ScheduledDialogs').then((module) => ({ default: module.ScheduledJobsDialog })))
export const ScheduledDraftDialog = lazy(() => import('./ScheduledDialogs').then((module) => ({ default: module.ScheduledDraftDialog })))
export const MediaApprovalDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.MediaApprovalDialog })))
export const GeneratedImageDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.GeneratedImageDialog })))
export const LeaveRoomDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.LeaveRoomDialog })))
export const RedactDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.RedactDialog })))
export const ForwardMessageDialog = lazy(() => import('./RoomDialogs').then((module) => ({ default: module.ForwardMessageDialog })))
export const MediaGalleryDialog = lazy(() => import('./RoomDialogs').then((module) => ({ default: module.MediaGalleryDialog })))
