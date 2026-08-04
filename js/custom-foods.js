export function upsertCustomFood(data, foodInput, existingId = null) {
  const normalized = {
    ...data,
    customFoods: Array.isArray(data?.customFoods) ? [...data.customFoods] : [],
  };

  const payload = {
    id: existingId || crypto.randomUUID(),
    name: foodInput.name?.trim() || 'Unbenannt',
    weightGrams: Number(foodInput.weightGrams) > 0 ? Number(foodInput.weightGrams) : 100,
    kcal: Number(foodInput.kcal) || 0,
    protein: Number(foodInput.protein) || 0,
    carbs: Number(foodInput.carbs) || 0,
    fat: Number(foodInput.fat) || 0,
    fiber: Number(foodInput.fiber) || 0,
  };

  if (existingId) {
    const index = normalized.customFoods.findIndex((food) => food.id === existingId);
    if (index >= 0) {
      normalized.customFoods[index] = payload;
      return normalized;
    }
  }

  normalized.customFoods.push(payload);
  return normalized;
}
