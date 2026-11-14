# Roomia — « Envoyer à Roomia » for SketchUp.
# Sends the open model and its scenes (saved views) to Roomia Desktop on the same PC.
require 'sketchup.rb'
require 'extensions.rb'

module Roomia
  module Envoyer
    VERSION = '0.3.0'.freeze

    unless file_loaded?(__FILE__)
      ext = SketchupExtension.new('Roomia — Envoyer à Roomia', 'roomia_envoyer/main')
      ext.description = 'Envoie le modèle et ses scènes à Roomia Desktop : rendus, visite 360° et plans sur votre carte graphique.'
      ext.version = VERSION
      ext.creator = 'Roomia'
      ext.copyright = '© Roomia'
      Sketchup.register_extension(ext, true)
      file_loaded(__FILE__)
    end
  end
end
