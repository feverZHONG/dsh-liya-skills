// dsh-liya-skills · client 半入口（settings.section：莉娅技能管理）
var page = require('./page')

exports.inject = ['slots']
exports.apply = function (ctx) {
  var slots = ctx.get('slots')
  if (slots === undefined) return
  slots.inject('settings.section', function () {
    return slots.register(
      {
        name: 'settings.section',
        id: 'dsh-liya-skills',
        order: 140,
        label: function () { return '莉娅技能' },
      },
      page.SkillAdminPage
    )
  })
}
