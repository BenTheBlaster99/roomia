# Roomia — « Envoyer à Roomia ».
#
# One click exports the open model into Roomia Desktop's inbox (%LOCALAPPDATA%\Roomia\inbox\<folder>):
#   model.dae + its texture folder   the geometry and materials (SketchUp's COLLADA exporter)
#   model.skp                        a copy of the saved file: Roomia takes from it any texture the export left out
#   views.json                       the scenes (saved views) with their cameras, in SketchUp's own units (inches)
#   roomia-send.json                 the title, the model's id (the same model sent again is a new version), versions
#   ready                            written last: Roomia imports the folder once it appears
# then wakes Roomia with roomia://import/<folder>. Roomia turns the folder into a project (lib/desktop-inbox.ts).
require 'sketchup.rb'
require 'json'
require 'fileutils'

module Roomia
  module Envoyer
    MAX_SKP_BYTES = 1_500_000_000

    def self.roomia_data_dir
      base = ENV['LOCALAPPDATA']
      return nil if base.nil? || base.empty?
      File.join(base.dup.force_encoding('UTF-8'), 'Roomia')
    end

    def self.views_of(model)
      model.pages.map do |page|
        cam = page.camera
        next nil unless cam
        {
          'name' => page.name,
          'camera' => {
            'eye' => cam.eye.to_a,
            'target' => cam.target.to_a,
            'up' => cam.up.to_a,
            'fov' => cam.fov,
            'perspective' => cam.perspective?
          }
        }
      end.compact
    end

    def self.send_model
      model = Sketchup.active_model
      return UI.messagebox('Ouvrez d’abord un modèle.') unless model

      data = roomia_data_dir
      unless data && File.directory?(data)
        UI.messagebox("Roomia Desktop n’est pas installé sur ce PC, ou n’a jamais été ouvert.\n\nOuvrez Roomia une fois, puis recommencez.")
        return
      end

      views = views_of(model)
      perspective = views.count { |v| v['camera']['perspective'] }
      if perspective.zero?
        answer = UI.messagebox(
          "Ce modèle n’a aucune scène en perspective.\n\nRoomia placera lui-même les points de vue de la visite, mais les photos se font depuis vos scènes : " \
          "enregistrez vos vues (Fenêtre → Scènes → +) pour les retrouver dans Roomia.\n\nEnvoyer quand même ?",
          MB_YESNO
        )
        return unless answer == IDYES
      end

      stamp = Time.now.strftime('%Y%m%d-%H%M%S') + '-' + rand(36**4).to_s(36)
      dir = File.join(data, 'inbox', stamp)
      FileUtils.mkdir_p(dir)

      title = model.title.to_s.strip
      title = 'Projet SketchUp' if title.empty?

      Sketchup.status_text = 'Roomia : export du modèle…'
      options = {
        :triangulated_faces => true,
        :doublesided_faces => true,
        :edges => false,
        :author_attribution => false,
        :texture_maps => true,
        :selectionset_only => false,
        :preserve_instancing => true,
        :hidden_geometry => false,
        :show_summary => false
      }
      exported = model.export(File.join(dir, 'model.dae'), options)
      unless exported && File.exist?(File.join(dir, 'model.dae'))
        FileUtils.rm_rf(dir)
        UI.messagebox('L’export du modèle a échoué. Enregistrez le modèle et réessayez.')
        return
      end

      # every texture of the model, for the images the COLLADA export left out (Roomia matches them by name)
      skp = model.path.to_s
      if !skp.empty? && File.exist?(skp) && File.size(skp) <= MAX_SKP_BYTES
        Sketchup.status_text = 'Roomia : copie des textures…'
        FileUtils.cp(skp, File.join(dir, 'model.skp'))
      end

      File.write(File.join(dir, 'views.json'), JSON.generate(views))
      info = {
        'title' => title,
        'guid' => model.guid,
        'skp' => skp,
        'sketchup' => Sketchup.version,
        'extension' => VERSION,
        'views' => views.length,
        'modified' => model.modified?,
        'at' => Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ')
      }
      File.write(File.join(dir, 'roomia-send.json'), JSON.generate(info))
      File.write(File.join(dir, 'ready'), '1')
      Sketchup.status_text = 'Roomia : envoyé.'

      # wakes Roomia, or starts it; it also picks the folder up by itself when it is already open
      UI.openURL("roomia://import/#{stamp}")
      note = model.modified? ? "\n\nLe modèle a des modifications non enregistrées : elles sont dans l’envoi, mais pensez à enregistrer." : ''
      UI.messagebox("« #{title} » est envoyé à Roomia (#{perspective} vue#{perspective > 1 ? 's' : ''}).\n\nLe projet s’ouvre dans Roomia.#{note}")
    rescue StandardError => e
      Sketchup.status_text = ''
      UI.messagebox("Envoi à Roomia impossible : #{e.message}")
    end

    unless file_loaded?(__FILE__)
      icons = File.join(File.dirname(__FILE__), 'icons')
      command = UI::Command.new('Envoyer à Roomia') { send_model }
      command.tooltip = 'Envoyer à Roomia'
      command.status_bar_text = 'Envoie le modèle et ses scènes à Roomia Desktop (rendus, visite 360°, plans).'
      command.small_icon = File.join(icons, 'roomia-16.png')
      command.large_icon = File.join(icons, 'roomia-24.png')
      # 0.3.0 (14 Nov): a Roomia submenu, with a way to open Roomia (it is the app that installs this extension now)
      menu = UI.menu('Extensions').add_submenu('Roomia')
      menu.add_item(command)
      menu.add_item('Ouvrir Roomia') { UI.openURL('roomia://open') }
      toolbar = UI::Toolbar.new('Roomia')
      toolbar.add_item(command)
      toolbar.restore
      file_loaded(__FILE__)
    end
  end
end
