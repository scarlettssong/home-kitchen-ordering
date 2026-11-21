-- Keep the synthetic rows and their existing order snapshots intact.
UPDATE menu_item AS dish
SET name = sample.english_name,
    description = sample.description,
    recipe = sample.recipe::jsonb
FROM (VALUES
    (1, '姜葱香米饭', 'Ginger Scallion Rice',
     'Fluffy jasmine rice tossed with fresh ginger, scallions, and sesame oil.', $recipe$
    {
      "ingredients": [
        {"name":"Jasmine rice","amount":"200 g"},
        {"name":"Water","amount":"240 ml"},
        {"name":"Fresh ginger","amount":"15 g"},
        {"name":"Scallions","amount":"3"},
        {"name":"Neutral oil","amount":"2 tbsp"},
        {"name":"Sesame oil","amount":"1 tsp"},
        {"name":"Fine salt","amount":"½ tsp"},
        {"name":"Toasted white sesame seeds","amount":"1 tsp"}
      ],
      "steps": [
        "Rinse the rice in cold water two or three times, until the water is mostly clear.",
        "Put the drained rice and measured water in a small saucepan. Let the rice soak for 10 minutes.",
        "Bring to a boil over medium heat. Cover, reduce the heat to low, and simmer for 12 minutes. Remove from the heat and let it stand, covered, for 10 minutes.",
        "Peel and mince the ginger. Thinly slice the scallions and separate the white and green parts.",
        "Heat the neutral oil over medium-low heat. Stir in the ginger and scallion whites. Cook for about a minute, until fragrant.",
        "Turn off the heat. Stir in half the scallion greens, the sesame oil, and the salt.",
        "Fluff the rice. Add the ginger-scallion oil in two batches and gently fold it through the rice.",
        "Serve warm, topped with the remaining scallion greens and the toasted sesame seeds."
      ],
      "tips": "The oil coats warm rice more evenly. For milder ginger flavor, mince it finely and cook it for an extra 30 seconds."
    }$recipe$),
    (2, '芝麻蔬菜煎饺', 'Sesame Garden Dumplings',
     'Golden pan-fried vegetable dumplings with a sesame dipping sauce.', $recipe$
    {
      "ingredients": [
        {"name":"Dumpling wrappers","amount":"12"},
        {"name":"Cabbage","amount":"160 g"},
        {"name":"Shiitake mushrooms","amount":"4"},
        {"name":"Oil","amount":"1 tbsp"},
        {"name":"Light soy sauce and rice vinegar","amount":"1 tbsp each"},
        {"name":"Toasted sesame seeds","amount":"1 tsp"}
      ],
      "steps": [
        "Finely chop the cabbage and mushrooms. Sauté in a little oil until the excess moisture evaporates, then let the filling cool.",
        "Moisten the edges of each wrapper with water, add a small spoonful of filling, and pinch to seal.",
        "Brush a skillet with oil. Fry the dumplings until lightly golden underneath, then add a splash of water. Cover and steam for about five minutes.",
        "Uncover and cook off the remaining water. Mix the soy sauce, vinegar, and sesame seeds, and serve alongside the dumplings."
      ],
      "tips": "Cool the filling before wrapping so the dough is easier to seal."
    }$recipe$),
    (3, '番茄罗勒烤吐司', 'Tomato Basil Toast',
     'Sweet roasted cherry tomatoes and fresh basil on crisp sourdough.', $recipe$
    {
      "ingredients": [
        {"name":"Sourdough bread","amount":"2 slices"},
        {"name":"Cherry tomatoes","amount":"180 g"},
        {"name":"Olive oil","amount":"1 tbsp"},
        {"name":"Basil leaves","amount":"6"}
      ],
      "steps": [
        "Halve the tomatoes and toss with olive oil and a pinch of salt.",
        "Roast at 210°C (410°F) for 12 minutes, until the tomatoes soften. Toast the sourdough until crisp.",
        "Spoon the tomatoes and their juices over the toast. Tear the basil and scatter it on top."
      ]
    }$recipe$),
    (4, '味噌蘑菇饭团', 'Miso Mushroom Onigiri',
     'Warm rice triangles filled with miso mushrooms and wrapped in nori.', $recipe$
    {
      "ingredients": [
        {"name":"Warm Japanese short-grain rice","amount":"300 g"},
        {"name":"Fresh mushrooms","amount":"100 g"},
        {"name":"White miso","amount":"2 tsp"},
        {"name":"Nori","amount":"2 sheets"}
      ],
      "steps": [
        "Finely chop the mushrooms and sauté until nearly dry. Loosen the miso with a little water, stir it into the mushrooms, and cook briefly to reduce.",
        "Wet your hands and divide the rice into two portions. Wrap each around a spoonful of mushrooms and gently press into a triangle.",
        "Cut the nori into narrow strips and wrap them around the bases just before serving."
      ],
      "tips": "Wrap with nori right before serving to keep it crisp."
    }$recipe$),
    (5, '蜂蜜燕麦布丁', 'Honey Oat Pudding',
     'Creamy oat-milk pudding finished with a drizzle of honey.', $recipe$
    {
      "ingredients": [
        {"name":"Oat milk","amount":"250 ml"},
        {"name":"Quick oats","amount":"35 g"},
        {"name":"Cornstarch","amount":"8 g"},
        {"name":"Honey","amount":"1 tbsp"}
      ],
      "steps": [
        "Whisk the cornstarch with a little cold oat milk. Put the remaining milk and the oats into a saucepan.",
        "Cook over medium-low heat until the oats soften. Add the cornstarch slurry and stir until thickened.",
        "Divide into small cups, cool, and refrigerate. Drizzle with honey before serving."
      ]
    }$recipe$),
    (6, '柑橘云朵蛋糕', 'Citrus Cloud Cake',
     'A light sponge with fragrant orange zest.', $recipe$
    {
      "ingredients": [
        {"name":"Eggs","amount":"3"},
        {"name":"Caster sugar","amount":"65 g"},
        {"name":"Cake flour","amount":"75 g"},
        {"name":"Orange zest","amount":"1 tsp"}
      ],
      "steps": [
        "Beat the eggs and sugar until the whisk leaves a trail that holds briefly.",
        "Sift in the flour, add the orange zest, and fold gently. Pour into a cake pan.",
        "Bake at 170°C (340°F) for about 25 minutes. Cool, slice, and serve with fresh citrus."
      ]
    }$recipe$)
) AS sample(id, previous_name, english_name, description, recipe)
WHERE dish.id = sample.id AND dish.name = sample.previous_name AND dish.legacy_source_key IS NULL;

UPDATE kitchen_account
SET nickname = 'Kitchen Manager'
WHERE username = 'demo_kitchen_manager' AND role = 'ADMIN' AND nickname = '小厨房店长';
