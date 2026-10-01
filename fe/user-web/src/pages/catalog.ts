import type { PublicBranch, PublicService } from '@clinic/generated-api-types'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export const catalogKeys = {
  branches: ['public-catalog', 'branches'] as const,
  specialties: ['public-catalog', 'specialties'] as const,
  services: (branchId: string, specialtyId = '') => ['public-catalog', 'services', branchId, specialtyId] as const,
  doctors: (branchId = '', specialtyId = '', serviceId = '') =>
    ['public-catalog', 'doctors', branchId, specialtyId, serviceId] as const,
}

export function useBranches() {
  return useQuery({
    queryKey: catalogKeys.branches,
    queryFn: async () => (await api.publicCatalog.branches()).data,
    staleTime: 5 * 60_000,
  })
}

export function useSpecialties() {
  return useQuery({
    queryKey: catalogKeys.specialties,
    queryFn: async () => (await api.publicCatalog.specialties()).data,
    staleTime: 5 * 60_000,
  })
}

export function useServices(branchId: string, specialtyId = '') {
  return useQuery({
    queryKey: catalogKeys.services(branchId, specialtyId),
    queryFn: async () => (await api.publicCatalog.services({
      branchPublicId: branchId,
      ...(specialtyId ? { specialtyPublicId: specialtyId } : {}),
    })).data,
    enabled: !!branchId,
    staleTime: 2 * 60_000,
  })
}

export function useDoctors(filters: { branchId?: string; specialtyId?: string; serviceId?: string }) {
  return useQuery({
    queryKey: catalogKeys.doctors(filters.branchId, filters.specialtyId, filters.serviceId),
    queryFn: async () => (await api.publicCatalog.doctors({
      ...(filters.branchId ? { branchPublicId: filters.branchId } : {}),
      ...(filters.specialtyId ? { specialtyPublicId: filters.specialtyId } : {}),
      ...(filters.serviceId ? { servicePublicId: filters.serviceId } : {}),
    })).data,
    staleTime: 2 * 60_000,
  })
}

export function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').trim()
}

export function fullAddress(branch: PublicBranch) {
  return [branch.addressLine, branch.ward, branch.district, branch.province].filter(Boolean).join(', ')
}

export function serviceTypeLabel(value: PublicService['type']) {
  const labels: Record<PublicService['type'], string> = {
    CONSULTATION: 'Khám bệnh', LAB: 'Xét nghiệm', IMAGING: 'Chẩn đoán hình ảnh',
    PROCEDURE: 'Thủ thuật', VACCINATION: 'Tiêm chủng', OTHER: 'Dịch vụ khác',
  }
  return labels[value]
}

export function bookingUrl(filters: { branchId?: string; serviceId?: string; doctorId?: string }) {
  const search = new URLSearchParams()
  if (filters.branchId) search.set('branch', filters.branchId)
  if (filters.serviceId) search.set('service', filters.serviceId)
  if (filters.doctorId) search.set('doctor', filters.doctorId)
  return `/booking${search.size ? `?${search}` : ''}`
}
