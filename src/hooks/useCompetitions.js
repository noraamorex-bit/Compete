import { useCallback, useEffect, useState } from "react";
import { loadCompetitions, saveCompetitions } from "../lib/storage.js";

export function useCompetitions() {
  const [competitions, setCompetitions] = useState(loadCompetitions);

  useEffect(() => {
    saveCompetitions(competitions);
  }, [competitions]);

  const add = useCallback((data) => {
    const item = {
      ...data,
      id: crypto.randomUUID(),
      favorite: false,
      createdAt: new Date().toISOString(),
    };
    setCompetitions((list) => [item, ...list]);
    return item;
  }, []);

  const update = useCallback((id, patch) => {
    setCompetitions((list) =>
      list.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }, []);

  const remove = useCallback((id) => {
    setCompetitions((list) => list.filter((c) => c.id !== id));
  }, []);

  const toggleFavorite = useCallback((id) => {
    setCompetitions((list) =>
      list.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c))
    );
  }, []);

  return { competitions, add, update, remove, toggleFavorite };
}
