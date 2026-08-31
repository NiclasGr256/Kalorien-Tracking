export async function callAi(messages, apiKey) {
  const body = {
    model: 'gpt-4o-mini',
    messages: messages,
    tools: [
      {
        type: 'function',
        function: {
          name: 'add_entry',
          description: 'Fügt einen Kalorieneintrag für ein bestimmtes Datum hinzu.',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Datum im Format YYYY-MM-DD' },
              name: { type: 'string', description: 'Name des Lebensmittels' },
              kcal: { type: 'number' },
              protein: { type: 'number' },
              carbs: { type: 'number' },
              fat: { type: 'number' },
              fiber: { type: 'number' },
              weightGrams: { type: 'number' },
              unit: { type: 'string', enum: ['g', 'ml', 'stk'], description: 'Einheit der Menge' },
              meal: { type: 'string', enum: ['frühstück', 'mittag', 'abend', 'snack'] }
            },
            required: ['date', 'name', 'kcal', 'meal']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'set_goals',
          description: 'Setzt die täglichen Nährwertziele.',
          parameters: {
            type: 'object',
            properties: {
              kcal: { type: 'number' },
              protein: { type: 'number' },
              carbs: { type: 'number' },
              fat: { type: 'number' },
              fiber: { type: 'number' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'delete_entry',
          description: 'Löscht einen Eintrag anhand seiner ID.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              date: { type: 'string', description: 'Datum des Eintrags YYYY-MM-DD' }
            },
            required: ['id', 'date']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_data',
          description: 'Ruft alle Daten ab (Einträge, Ziele, eigene Gerichte), um Fragen dazu zu beantworten oder Analysen durchzuführen.',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'add_custom_food',
          description: 'Speichert ein neues Gericht in der Liste der eigenen Gerichte.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              weightGrams: { type: 'number' },
              unit: { type: 'string', enum: ['g', 'ml', 'stk'], description: 'Einheit der Menge' },
              kcal: { type: 'number' },
              protein: { type: 'number' },
              carbs: { type: 'number' },
              fat: { type: 'number' },
              fiber: { type: 'number' }
            },
            required: ['name', 'kcal']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_entry',
          description: 'Aktualisiert einen bestehenden Kalorieneintrag (z.B. Menge oder Name ändern).',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Die ID des zu ändernden Eintrags' },
              date: { type: 'string', description: 'Das Datum des Eintrags YYYY-MM-DD' },
              name: { type: 'string' },
              kcal: { type: 'number' },
              protein: { type: 'number' },
              carbs: { type: 'number' },
              fat: { type: 'number' },
              fiber: { type: 'number' },
              weightGrams: { type: 'number' },
              unit: { type: 'string', enum: ['g', 'ml', 'stk'], description: 'Einheit der Menge' },
              meal: { type: 'string', enum: ['frühstück', 'mittag', 'abend', 'snack'] }
            },
            required: ['id', 'date']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'set_weight',
          description: 'Speichert das Körpergewicht für ein bestimmtes Datum.',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Datum im Format YYYY-MM-DD' },
              weight: { type: 'number', description: 'Gewicht in kg' },
              period: { type: 'boolean', description: 'Ob der Nutzer die Periode hat' }
            },
            required: ['date', 'weight']
          }
        }
      }
      ],
      tool_choice: 'auto'
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'AI Request failed');
  }

  return response.json();
}
