ALTER TABLE menu_item
    ADD COLUMN image_path varchar(160),
    ADD COLUMN recipe jsonb NOT NULL DEFAULT '{"ingredients":[],"steps":[]}';

-- Translate the demo menu without changing any saved order line snapshots.
UPDATE menu_item AS dish
SET name = demo.name,
    description = demo.description,
    image_path = '/images/' || demo.photo || '.jpg',
    recipe = demo.recipe::jsonb
FROM (VALUES
    (1, '姜葱香米饭', '蓬松的茉莉香米拌入鲜姜、青葱和一点芝麻油。', 'ginger-rice', $recipe$
    {
      "ingredients": [
        {"name":"茉莉香米","amount":"200 克"},
        {"name":"清水","amount":"240 毫升"},
        {"name":"鲜姜","amount":"15 克"},
        {"name":"青葱","amount":"3 根"},
        {"name":"中性植物油","amount":"2 汤匙"},
        {"name":"芝麻油","amount":"1 茶匙"},
        {"name":"细盐","amount":"½ 茶匙"},
        {"name":"熟白芝麻","amount":"1 茶匙"}
      ],
      "steps": [
        "将香米放入大碗，加冷水轻轻搅动，换水冲洗两到三次，直到淘米水基本清澈。",
        "将沥干的米放进小锅，加入清水，静置十分钟，让米粒充分吸水。",
        "中火煮至沸腾，盖上锅盖转小火煮十二分钟。关火后保持锅盖盖好，再焖十分钟。",
        "姜去皮后切细末。青葱切小圈，把葱白、葱绿分开放。",
        "小锅里放中性植物油，以中小火加热。加入姜末和葱白，轻轻翻炒约一分钟，炒到有香气但没有变色。",
        "关火，加入一半葱绿、芝麻油和细盐，搅匀成为姜葱油。保留少量葱绿用来装盘。",
        "打开饭锅，用饭勺翻松米饭。分两次淋入姜葱油，轻轻拌匀，尽量保持米粒完整。",
        "趁热装碗，撒上剩下的葱绿和熟白芝麻。可搭配清淡的蒸蔬菜一起吃。"
      ],
      "tips": "姜葱油拌进热饭时更容易散开。如果想要更柔和的姜味，可以把姜切细一点，再多炒半分钟。"
    }$recipe$),
    (2, '芝麻蔬菜煎饺', '底面煎得金黄，配一小碟芝麻蘸汁。', 'sesame-dumplings', $recipe$
    {
      "ingredients": [
        {"name":"饺子皮","amount":"12 张"},
        {"name":"卷心菜","amount":"160 克"},
        {"name":"香菇","amount":"4 朵"},
        {"name":"油","amount":"1 汤匙"},
        {"name":"生抽和米醋","amount":"各 1 汤匙"},
        {"name":"熟芝麻","amount":"1 茶匙"}
      ],
      "steps": [
        "卷心菜和香菇切碎。用少量油翻炒至水分收干，放凉作馅。",
        "在饺子皮边缘抹水，包入一小勺馅，捏紧饺子口。",
        "平底锅刷油，把饺子排好煎至底面浅金黄。加少量水后盖锅，蒸煎约五分钟。",
        "开盖煎干锅内的水。将生抽、米醋与芝麻拌匀，和煎饺一起上桌。"
      ],
      "tips": "饺子馅放凉后再包，饺子皮更容易捏紧。"
    }$recipe$),
    (3, '番茄罗勒烤吐司', '烤得香甜的小番茄和新鲜罗勒，搭配脆酸面包。', 'tomato-toast', $recipe$
    {
      "ingredients": [
        {"name":"酸面包","amount":"2 片"},
        {"name":"小番茄","amount":"180 克"},
        {"name":"橄榄油","amount":"1 汤匙"},
        {"name":"罗勒叶","amount":"6 片"}
      ],
      "steps": [
        "小番茄对半切开，拌橄榄油和少许盐。",
        "在 210°C 烤箱中烤十二分钟，直到番茄变软。烤脆酸面包。",
        "将番茄和烤出的汁液铺到吐司上，撕碎罗勒叶撒在顶部。"
      ]
    }$recipe$),
    (4, '味噌蘑菇饭团', '海苔包着暖米饭，里面是带味噌香气的蘑菇。', 'miso-onigiri', $recipe$
    {
      "ingredients": [
        {"name":"温热日式米饭","amount":"300 克"},
        {"name":"鲜蘑菇","amount":"100 克"},
        {"name":"白味噌","amount":"2 茶匙"},
        {"name":"海苔","amount":"2 片"}
      ],
      "steps": [
        "蘑菇切碎后炒至略干，加入用少量清水化开的味噌，稍炒收汁。",
        "湿润双手，把米饭分成两份，每份包入一勺蘑菇，再轻压成三角形。",
        "把海苔剪成细长条，食用前裹住饭团底部。"
      ],
      "tips": "海苔最后再裹，口感更脆。"
    }$recipe$),
    (5, '蜂蜜燕麦布丁', '细腻的燕麦奶香，食用前淋上一点蜂蜜。', 'oat-pudding', $recipe$
    {
      "ingredients": [
        {"name":"燕麦奶","amount":"250 毫升"},
        {"name":"即食燕麦","amount":"35 克"},
        {"name":"玉米淀粉","amount":"8 克"},
        {"name":"蜂蜜","amount":"1 汤匙"}
      ],
      "steps": [
        "取少量冷燕麦奶调开淀粉，把其余燕麦奶和燕麦下锅。",
        "中小火煮至燕麦软化，倒入淀粉浆，边搅拌边煮至浓稠。",
        "分装到小杯，放凉后冷藏，食用前淋上蜂蜜。"
      ]
    }$recipe$),
    (6, '柑橘云朵蛋糕', '清香的柑橘皮屑配上轻软的海绵蛋糕。', 'citrus-cake', $recipe$
    {
      "ingredients": [
        {"name":"鸡蛋","amount":"3 个"},
        {"name":"细砂糖","amount":"65 克"},
        {"name":"低筋面粉","amount":"75 克"},
        {"name":"橙皮屑","amount":"1 茶匙"}
      ],
      "steps": [
        "打发蛋液和细砂糖，直到用打蛋头划出的纹路能短暂停留。",
        "筛入面粉，加入橙皮屑，轻轻翻拌均匀后倒入蛋糕模。",
        "以 170°C 烤约二十五分钟。放凉后切片，搭配新鲜柑橘食用。"
      ]
    }$recipe$)
) AS demo(id, name, description, photo, recipe)
WHERE dish.id = demo.id;
