import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchSheetData, fetchScheduleData, refreshData, getTeams, getProducts } from '../utils/parseSheet';

export function useSheetData() {
  const [allRuns, setAllRuns] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [scheduleSnapshots, setScheduleSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const [teamFilter, setTeamFilter] = useState('All');
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const [productFilter, setProductFilter] = useState('All');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runs, schedResult] = await Promise.all([fetchSheetData(), fetchScheduleData()]);
      setAllRuns(runs);
      setSchedule(schedResult.data);
      setScheduleSnapshots(schedResult.snapshots);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshData();
      const [runs, schedResult] = await Promise.all([fetchSheetData(), fetchScheduleData()]);
      setAllRuns(runs);
      setSchedule(schedResult.data);
      setScheduleSnapshots(schedResult.snapshots);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runs = useMemo(() => {
    return allRuns.filter((r) => {
      if (teamFilter !== 'All' && r.team !== teamFilter) return false;
      if (productFilter !== 'All' && r.product !== productFilter) return false;
      if (dateRange.start && r.date < dateRange.start) return false;
      if (dateRange.end && r.date > dateRange.end) return false;
      return true;
    });
  }, [allRuns, teamFilter, dateRange, productFilter]);

  const teams = useMemo(() => getTeams(allRuns), [allRuns]);
  const products = useMemo(() => getProducts(allRuns), [allRuns]);

  return {
    runs,
    allRuns,
    schedule,
    scheduleSnapshots,
    loading,
    error,
    lastRefresh,
    refresh,
    teams,
    products,
    teamFilter,
    setTeamFilter,
    dateRange,
    setDateRange,
    productFilter,
    setProductFilter,
  };
}
