import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import type {
  ProgressResponse,
  Gamification,
  CicloResponse,
  HistoryItem,
  PostsPage,
  TrafficResponse,
  CalendarResponse,
  ProfileResponse,
  Report,
  InviteResponse,
  DebriefingResponse,
  DebriefingStatus,
} from './types';

export function useProgress() {
  return useQuery({
    queryKey: ['my-progress'],
    queryFn: () => sipApi<ProgressResponse>('/my-progress', { throwOnError: true }),
    refetchInterval: 60_000,
  });
}

export function useGamification(enabled = true) {
  return useQuery({
    queryKey: ['gamification'],
    queryFn: () => sipApi<Gamification>('/me/gamification', { throwOnError: true }),
    enabled,
  });
}

export function useCiclo() {
  return useQuery({
    queryKey: ['me-ciclo'],
    queryFn: () => sipApi<CicloResponse>('/me/ciclo', { throwOnError: true }),
  });
}

export function useHistory() {
  return useQuery({
    queryKey: ['me-ciclo-history'],
    queryFn: () => sipApi<HistoryItem[]>('/me/ciclo-history', { throwOnError: true }),
  });
}

export function usePosts() {
  return useQuery({
    queryKey: ['posts'],
    queryFn: () => sipApi<PostsPage>('/posts?limit=100', { throwOnError: true }),
  });
}

export function useTraffic() {
  return useQuery({
    queryKey: ['traffic'],
    queryFn: () => sipApi<TrafficResponse>('/traffic', { throwOnError: true }),
  });
}

export function useCalendar() {
  return useQuery({
    queryKey: ['me-calendar'],
    queryFn: () => sipApi<CalendarResponse>('/me/calendar', { throwOnError: true }),
  });
}

export function useProfile() {
  return useQuery({
    queryKey: ['me-profile'],
    queryFn: () => sipApi<ProfileResponse>('/me/profile', { throwOnError: true }),
  });
}

export function useReports() {
  return useQuery({
    queryKey: ['me-reports'],
    queryFn: () => sipApi<Report[]>('/me/reports', { throwOnError: true }),
  });
}

export function useInvite() {
  return useQuery({
    queryKey: ['me-invite'],
    queryFn: () => sipApi<InviteResponse>('/me/invite', { throwOnError: true }),
  });
}

export function useDebriefing() {
  return useQuery({
    queryKey: ['debriefing'],
    queryFn: () => sipApi<DebriefingResponse>('/debriefing', { throwOnError: true }),
  });
}

export function useDebriefingStatus() {
  return useQuery({
    queryKey: ['debriefing-status'],
    queryFn: () => sipApi<DebriefingStatus>('/debriefing-status', { throwOnError: true }),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { taskId: string; completed: boolean; link?: string; completed_at?: string }) =>
      sipApi('/tasks/' + args.taskId + '/complete', {
        method: 'POST',
        body: JSON.stringify({ completed: args.completed, link: args.link, completed_at: args.completed_at }),
        throwOnError: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
  });
}
